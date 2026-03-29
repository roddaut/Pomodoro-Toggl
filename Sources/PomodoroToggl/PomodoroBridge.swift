import WebKit

final class PomodoroBridge: NSObject, WKScriptMessageHandler {
  let deskReminder: DeskReminderController

  init(deskReminder: DeskReminderController) {
    self.deskReminder = deskReminder
  }

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    guard message.name == "pomodoro" else { return }
    guard let body = message.body as? [String: Any] else { return }
    guard let type = body["type"] as? String, type == "phase" else { return }
    let phase = body["phase"] as? String ?? "idle"
    let connected = body["connected"] as? Bool ?? false
    deskReminder.updatePhase(phase: phase, connected: connected)
  }
}
