import AuthenticationServices
import CryptoKit
import Foundation
import Security

/// Google sign-in for sync, done the way Google allows for apps: its sign-in page opens in Safari's own sheet (saved
/// Google login, passkeys), then a code + PKCE exchange gives an access token and a refresh token. The refresh token
/// stays in the Keychain on this phone, so later tokens come silently. The page gets only short-lived access tokens.
/// Scope: drive.appdata, the app's hidden Drive folder (shared by every client of the same Cloud project, so the
/// iPhone app sees the same vault as the website).
@MainActor
enum GoogleAuth {
  private static let clientID = "465085654408-u3ktks8unj6d3g400t572ebf6mjinf7m.apps.googleusercontent.com"
  private static let scheme = "com.googleusercontent.apps.465085654408-u3ktks8unj6d3g400t572ebf6mjinf7m"
  private static let redirect = "\(scheme):/oauth2redirect"
  private static let scope = "https://www.googleapis.com/auth/drive.appdata"
  private static let keychain: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "com.aj124.wallet",
    kSecAttrAccount as String: "google-refresh",
  ]
  private static var session: ASWebAuthenticationSession?

  struct Token {
    let value: String
    let expiresIn: Int
    var reply: [String: Any] { ["token": value, "expiresIn": expiresIn] }
  }

  /// Interactive: Safari's sign-in sheet, then a fresh refresh token.
  static func signIn(from anchor: ASWebAuthenticationPresentationContextProviding, hint: String?) async throws -> Token {
    let verifier = Data((0..<32).map { _ in UInt8.random(in: 0...255) }).base64URL
    let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
    let state = UUID().uuidString
    var url = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
    url.queryItems = [
      .init(name: "client_id", value: clientID), .init(name: "redirect_uri", value: redirect),
      .init(name: "response_type", value: "code"), .init(name: "scope", value: scope), .init(name: "state", value: state),
      .init(name: "code_challenge", value: challenge), .init(name: "code_challenge_method", value: "S256"),
      .init(name: "prompt", value: "select_account"),
    ] + (hint.map { [.init(name: "login_hint", value: $0)] } ?? [])

    let callback: URL = try await withCheckedThrowingContinuation { done in
      let s = ASWebAuthenticationSession(url: url.url!, callbackURLScheme: scheme) { url, error in
        if let url { done.resume(returning: url) } else { done.resume(throwing: error ?? URLError(.cancelled)) }
      }
      s.presentationContextProvider = anchor
      session = s
      s.start()
    }
    session = nil
    let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
    let value = { (name: String) in items.first { $0.name == name }?.value }
    guard value("state") == state else { throw GoogleError(message: "Sign-in answer did not match this request.") }
    guard let code = value("code") else { throw GoogleError(message: value("error") ?? "Sign-in was cancelled.") }

    let json = try await post(["code": code, "client_id": clientID, "redirect_uri": redirect,
                               "grant_type": "authorization_code", "code_verifier": verifier])
    if let refresh = json["refresh_token"] as? String { save(refresh) }
    return try token(json)
  }

  /// Silent: a new access token from the stored refresh token, or nil when signed out (or access was revoked).
  static func refresh() async throws -> Token? {
    guard let refresh = load() else { return nil }
    do {
      return try token(try await post(["refresh_token": refresh, "client_id": clientID, "grant_type": "refresh_token"]))
    } catch let error as GoogleError where error.message == "invalid_grant" {
      delete()
      return nil
    }
  }

  static func signOut() async {
    guard let refresh = load() else { return }
    delete()
    var req = URLRequest(url: URL(string: "https://oauth2.googleapis.com/revoke")!)
    req.httpMethod = "POST"
    req.httpBody = form(["token": refresh])
    req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    _ = try? await URLSession.shared.data(for: req)
  }

  // ---- helpers ----

  private static func post(_ fields: [String: String]) async throws -> [String: Any] {
    var req = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
    req.httpMethod = "POST"
    req.httpBody = form(fields)
    req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    let (data, _) = try await URLSession.shared.data(for: req)
    let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    if let error = json["error"] as? String { throw GoogleError(message: error) }
    return json
  }

  private static func token(_ json: [String: Any]) throws -> Token {
    guard let value = json["access_token"] as? String else { throw GoogleError(message: "Google sent no token.") }
    return Token(value: value, expiresIn: json["expires_in"] as? Int ?? 3600)
  }

  private static func form(_ fields: [String: String]) -> Data {
    var c = URLComponents()
    c.queryItems = fields.map { URLQueryItem(name: $0.key, value: $0.value) }
    // URLComponents leaves "+" alone, which a form body would read as a space
    return Data((c.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B").utf8)
  }

  private static func save(_ refresh: String) {
    delete()
    var item = keychain
    item[kSecValueData as String] = Data(refresh.utf8)
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(item as CFDictionary, nil)
  }

  private static func load() -> String? {
    var query = keychain
    query[kSecReturnData as String] = true
    var result: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private static func delete() {
    SecItemDelete(keychain as CFDictionary)
  }
}

struct GoogleError: Error {
  let message: String
}

private extension Data {
  var base64URL: String {
    base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }
}
