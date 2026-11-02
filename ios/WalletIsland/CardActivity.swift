import ActivityKit
import Foundation

/// What the Live Activity shows: a card in the Dynamic Island while its number sits in the clipboard. Shared by the
/// app (which starts it) and the widget extension (which draws it). The full number and CVV are here too, at the
/// owner's request: the views show them only in the expanded island, and only until the minute is up (stale date).
struct CardActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    /// when the copied number is cleared from the clipboard
    var until: Date
  }

  var bank: String
  var name: String
  var last4: String
  var expiry: String
  var network: String
  /// grouped as printed, for the expanded island only
  var number: String
  var cvv: String
  /// the card's two colours, as hex
  var color1: String
  var color2: String
}
