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
                                       number: s("formatted"), cvv: s("cvv"), color1: s("color1"), color2: s("color2"))
    let until = Date.now.addingTimeInterval(seconds)
    await endAll()
    // the number expires from the clipboard on its own too, in case the app is killed first
    UIPasteboard.general.setItems([[UIPasteboard.typeAutomatic: number]], options: [.expirationDate: until])
    guard available else { throw IslandError(message: "Live Activities are off for Wallet. Turn them on in Settings.") }
    // the activity must stay live to be in the Dynamic Island (an ended one only stays on the lock screen), so it is
    // ended when the minute is up: by the timer below, kept running in the background for that minute, or at the
    // next launch if iOS stopped the app first. Its stale date turns the island to "cleared" in any case, and the
    // clipboard expiry is iOS's own.
    _ = try Activity.request(attributes: attrs, content: .init(state: .init(until: until), staleDate: until))
    let app = UIApplication.shared
    var background = UIBackgroundTaskIdentifier.invalid
    background = app.beginBackgroundTask { app.endBackgroundTask(background) }
    clear = Task {
      try? await Task.sleep(for: .seconds(seconds))
      if !Task.isCancelled {
        UIPasteboard.general.items = []
        await endAll()
      }
      app.endBackgroundTask(background)
    }
  }

  /// At launch and on return: an activity whose minute is over (the app was stopped meanwhile) goes away.
  static func endExpired() async {
    for a in Activity<CardActivityAttributes>.activities where a.content.state.until <= .now {
      await a.end(nil, dismissalPolicy: .immediate)
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
