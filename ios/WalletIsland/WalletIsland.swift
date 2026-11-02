import ActivityKit
import SwiftUI
import WidgetKit

@main
struct WalletIslandBundle: WidgetBundle {
  var body: some Widget {
    CardActivityWidget()
  }
}

/// The card in the Dynamic Island (and on the lock screen) for the minute its number is in the clipboard.
struct CardActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: CardActivityAttributes.self) { context in
      LockScreenCard(card: context.attributes, until: context.state.until)
        .activityBackgroundTint(Color(hex: context.attributes.color1))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          BankBadge(card: context.attributes).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(context.attributes.network.uppercased())
            .font(.system(size: 13, weight: .heavy, design: .rounded).italic())
            .foregroundStyle(.white.opacity(0.9))
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(spacing: 2) {
            Text(context.attributes.name).font(.system(size: 15, weight: .semibold)).lineLimit(1)
            Text("•••• \(context.attributes.last4)").font(.system(size: 20, weight: .medium, design: .monospaced))
          }
          .foregroundStyle(.white)
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack {
            Label("Number copied", systemImage: "doc.on.doc.fill").font(.system(size: 12, weight: .medium))
            Spacer()
            Text("clears in ")
              .font(.system(size: 12))
            + Text(timerInterval: Date.now...context.state.until, countsDown: true)
              .font(.system(size: 12, weight: .semibold, design: .monospaced))
          }
          .foregroundStyle(.white.opacity(0.85))
          .padding(.horizontal, 4)
          .padding(.top, 2)
        }
      } compactLeading: {
        BankDot(card: context.attributes)
      } compactTrailing: {
        Text("•• \(context.attributes.last4)")
          .font(.system(size: 13, weight: .semibold, design: .monospaced))
          .foregroundStyle(.white)
      } minimal: {
        BankDot(card: context.attributes)
      }
      .keylineTint(Color(hex: context.attributes.color2))
    }
  }
}

/// The card's initial on its colour, like the bank mark on the face.
private struct BankDot: View {
  let card: CardActivityAttributes
  var body: some View {
    Text(String(card.bank.prefix(1)))
      .font(.system(size: 12, weight: .bold, design: .rounded))
      .foregroundStyle(.white)
      .frame(width: 22, height: 22)
      .background(LinearGradient(colors: [Color(hex: card.color1), Color(hex: card.color2)], startPoint: .topLeading, endPoint: .bottomTrailing))
      .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
  }
}

private struct BankBadge: View {
  let card: CardActivityAttributes
  var body: some View {
    HStack(spacing: 6) {
      BankDot(card: card)
      Text(card.bank).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
    }
  }
}

/// The lock-screen banner: a slim card face.
private struct LockScreenCard: View {
  let card: CardActivityAttributes
  let until: Date
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        BankBadge(card: card)
        Spacer()
        Text(card.network.uppercased()).font(.system(size: 13, weight: .heavy, design: .rounded).italic()).foregroundStyle(.white.opacity(0.9))
      }
      HStack(alignment: .firstTextBaseline) {
        Text("•••• •••• •••• \(card.last4)").font(.system(size: 18, weight: .medium, design: .monospaced))
        Spacer()
        Text(card.expiry).font(.system(size: 13, weight: .semibold, design: .monospaced)).foregroundStyle(.white.opacity(0.85))
      }
      .foregroundStyle(.white)
      HStack {
        Text(card.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
        Spacer()
        Label { Text(timerInterval: Date.now...until, countsDown: true).monospacedDigit() } icon: { Image(systemName: "doc.on.doc.fill") }
          .font(.system(size: 12, weight: .medium))
      }
      .foregroundStyle(.white.opacity(0.85))
    }
    .padding(16)
    .background(LinearGradient(colors: [Color(hex: card.color1), Color(hex: card.color2)], startPoint: .topLeading, endPoint: .bottomTrailing))
  }
}

extension Color {
  /// "#rrggbb" (or "rrggbb"); a bad value gives a neutral grey rather than a crash
  init(hex: String) {
    var h = hex.trimmingCharacters(in: .whitespaces)
    if h.hasPrefix("#") { h.removeFirst() }
    guard h.count == 6, let v = UInt32(h, radix: 16) else { self = Color(white: 0.3); return }
    self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
  }
}
