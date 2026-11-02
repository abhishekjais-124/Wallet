import ActivityKit
import UIKit

/// Shows a card in the Dynamic Island while its number is in the clipboard (one minute), then clears both.
@MainActor
enum Island {
  private static let seconds: TimeInterval = 60
  private static var clear: Task<Void, Never>?

  static var available: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

  /// `body`: bank, name, last4, expiry, network, color1, color2 and the full `number` to copy.
  static func show(_ body: [String: Any]) async throws {
    guard let number = body["number"] as? String else { throw IslandError(message: "No number to copy.") }
    let s = { (k: String) in body[k] as? String ?? "" }
    let attrs = CardActivityAttributes(bank: s("bank"), name: s("name"), last4: s("last4"), expiry: s("expiry"), network: s("network"),
                                       color1: s("color1"), color2: s("color2"))
    let until = Date.now.addingTimeInterval(seconds)
    await endAll()
    // the number expires from the clipboard on its own too, in case the app is killed first
    UIPasteboard.general.setItems([[UIPasteboard.typeAutomatic: number]], options: [.expirationDate: until])
    guard available else { throw IslandError(message: "Live Activities are off for Wallet. Turn them on in Settings.") }
    // the minute is enforced by iOS itself: the activity ends at `until` and the clipboard expires then too, so neither
    // needs the app to be awake. The timer below only tidies up early when it is.
    let activity = try Activity.request(attributes: attrs, content: .init(state: .init(until: until), staleDate: until))
    Task { await activity.end(.init(state: .init(until: until), staleDate: until), dismissalPolicy: .after(until)) }
    clear = Task {
      try? await Task.sleep(for: .seconds(seconds))
      guard !Task.isCancelled else { return }
      UIPasteboard.general.items = []
    }
  }

  static func endAll() async {
    clear?.cancel()
    for a in Activity<CardActivityAttributes>.activities {
      await a.end(nil, dismissalPolicy: .immediate)
    }
  }
}

struct IslandError: Error {
  let message: String
}
