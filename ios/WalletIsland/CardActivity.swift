import ActivityKit
import Foundation

/// What the Live Activity shows: a card in the Dynamic Island while its number sits in the clipboard. Shared by the
/// app (which starts it) and the widget extension (which draws it). Only what is printed on the face goes here:
/// never the full number or the CVV, since ActivityKit keeps this outside the app.
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
  /// the card's two colours, as hex
  var color1: String
  var color2: String
}
