import LocalAuthentication
import Security
import SwiftUI
import WebKit

/// The Wallet web app (aj124.com/Wallet) in a native shell, so Face ID is a plain face scan like other apps instead of
/// Safari's passkey sheet. Cards, crypto and sync all stay in the web app; this file only adds Face ID (the PIN kept in
/// the Keychain behind Face ID) and saving files the page downloads.
@main
struct WalletApp: App {
  var body: some Scene {
    WindowGroup {
      WalletWebView()
        .ignoresSafeArea()
        .background(Color(red: 8 / 255, green: 9 / 255, blue: 13 / 255))
    }
  }
}

// WALLET_URL (set when launching from Xcode or simctl) points it at a local build for testing
private let home = URL(string: ProcessInfo.processInfo.environment["WALLET_URL"] ?? "https://aj124.com/Wallet/")!

struct WalletWebView: UIViewRepresentable {
  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeUIView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.userContentController.addScriptMessageHandler(context.coordinator, contentWorld: .page, name: "walletBio")
    // Google refuses sign-in in web views that do not look like Safari
    let major = UIDevice.current.systemVersion.split(separator: ".").first ?? "18"
    config.applicationNameForUserAgent = "Version/\(major).0 Mobile/15E148 Safari/604.1"

    let web = WKWebView(frame: .zero, configuration: config)
    web.isOpaque = false
    web.backgroundColor = .clear
    web.scrollView.contentInsetAdjustmentBehavior = .never
    web.navigationDelegate = context.coordinator
    web.uiDelegate = context.coordinator
    web.load(URLRequest(url: home))
    return web
  }

  func updateUIView(_ web: WKWebView, context: Context) {}

  @MainActor
  final class Coordinator: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private var downloaded: URL?

    // ---- Face ID bridge: window.webkit.messageHandlers.walletBio.postMessage({ op, pin }) ----

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
      // only Wallet's own page may ask for the PIN
      guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == home.host,
            let body = message.body as? [String: Any], let op = body["op"] as? String else { return (nil, "Not allowed.") }
      do {
        switch op {
        case "available": return (PinStore.biometryLabel, nil)
        case "save":
          guard let pin = body["pin"] as? String, pin.count == 9, pin.allSatisfy(\.isNumber) else { return (nil, "Not a 9-digit PIN.") }
          try await PinStore.save(pin)
          return (true, nil)
        case "read": return (try await PinStore.read(), nil)
        case "delete":
          PinStore.delete()
          return (true, nil)
        default: return (nil, "Unknown request.")
        }
      } catch let error as PinStoreError {
        return (nil, error.message)
      } catch let error as LAError where [.userCancel, .appCancel, .systemCancel, .userFallback].contains(error.code) {
        return (nil, "\(PinStore.biometryLabel ?? "Face ID") was cancelled.")
      } catch {
        return (nil, error.localizedDescription)
      }
    }

    // ---- files the page saves (backup, recovery key, ID documents): handed to the share sheet ----

    func webView(_ web: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
      return action.shouldPerformDownload || action.request.url?.scheme == "blob" ? .download : .allow
    }

    func webView(_ web: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
      download.delegate = self
    }

    // window.open(...) of an ID file: download it instead of opening a second web view
    func webView(_ web: WKWebView, createWebViewWith config: WKWebViewConfiguration, for action: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
      web.startDownload(using: action.request) { $0.delegate = self }
      return nil
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String) async -> URL? {
      let url = FileManager.default.temporaryDirectory.appendingPathComponent(suggestedFilename)
      try? FileManager.default.removeItem(at: url)
      downloaded = url
      return url
    }

    func downloadDidFinish(_ download: WKDownload) {
      guard let url = downloaded,
            let root = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first?.rootViewController
      else { return }
      let top = root.presentedViewController ?? root
      let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
      sheet.popoverPresentationController?.sourceView = top.view
      top.present(sheet, animated: true)
    }
  }
}

struct PinStoreError: Error {
  let message: String
}

/// The 9-digit PIN in the Keychain, readable only after Face ID on this phone. Re-enrolling Face ID deletes it
/// (biometryCurrentSet), and it never leaves the device (ThisDeviceOnly, no iCloud Keychain).
enum PinStore {
  private static let base: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "com.aj124.wallet",
    kSecAttrAccount as String: "pin",
  ]

  static var biometryLabel: String? {
    let context = LAContext()
    guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else { return nil }
    return context.biometryType == .touchID ? "Touch ID" : "Face ID"
  }

  static func save(_ pin: String) async throws {
    let context = try await scan("Turn on Face ID for Wallet")
    var error: Unmanaged<CFError>?
    guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, &error)
    else { throw PinStoreError(message: "Could not protect the PIN.") }
    delete()
    var item = base
    item[kSecValueData as String] = Data(pin.utf8)
    item[kSecAttrAccessControl as String] = access
    item[kSecUseAuthenticationContext as String] = context
    let status = SecItemAdd(item as CFDictionary, nil)
    guard status == errSecSuccess else { throw PinStoreError(message: "Could not save the PIN (\(status)).") }
  }

  static func read() async throws -> String {
    let context = try await scan("Unlock Wallet")
    var query = base
    query[kSecReturnData as String] = true
    query[kSecUseAuthenticationContext as String] = context // already scanned: no second prompt
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    // the page turns this into "set it up again"
    if status == errSecItemNotFound { throw PinStoreError(message: "stale") }
    guard status == errSecSuccess, let data = result as? Data, let pin = String(data: data, encoding: .utf8)
    else { throw PinStoreError(message: "Could not read the PIN (\(status)).") }
    return pin
  }

  static func delete() {
    SecItemDelete(base as CFDictionary)
  }

  private static func scan(_ reason: String) async throws -> LAContext {
    let context = LAContext()
    context.localizedFallbackTitle = "" // no passcode button: the PIN pad is the fallback
    try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)
    return context
  }
}
