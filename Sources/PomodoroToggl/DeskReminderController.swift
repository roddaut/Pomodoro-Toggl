import AppKit
import CoreGraphics
import Foundation
import UserNotifications

/// Counts time spent "at the desk" (recent keyboard/mouse/scroll input) while the app is idle
/// and connected to Toggl, then fires a single notification until the user starts a session or steps away.
///
/// The embedded web UI must call `applyConfiguration` on launch (not only from Settings) so
/// `targetSeconds` matches persisted values; otherwise defaults from `init()` apply until then.
///
/// Option B: when the app is active, show an `NSAlert` sheet; when it is not, prefer a UN
/// notification, but always fall back to an alert if notifications are denied or delivery fails.
/// `hostWindow` must be set by `AppDelegate` so sheets never rely on `NSApp.mainWindow`.
final class DeskReminderController: NSObject {
  /// Main window for alert sheets; set by `AppDelegate` after the window is created.
  weak var hostWindow: NSWindow?

  private var tickTimer: Timer?
  private var activeSeconds: Double = 0
  private var reminderSent = false
  private var appPhase: String = ""
  private var connected = false

  private let idlePauseThreshold: TimeInterval
  private let idleResetThreshold: TimeInterval
  private var targetSeconds: TimeInterval
  private var enabled: Bool

  private static let notificationId = "com.pomodoro-toggl.desk-reminder"

  override init() {
    let env = ProcessInfo.processInfo.environment
    let deskSeconds = Double(env["POMODORO_DESK_SECONDS"] ?? "") ?? 600
    let idlePause = Double(env["POMODORO_DESK_IDLE_PAUSE"] ?? "") ?? 90
    let idleReset = Double(env["POMODORO_DESK_IDLE_RESET"] ?? "") ?? 120
    idlePauseThreshold = max(30, idlePause)
    idleResetThreshold = max(idlePauseThreshold + 10, idleReset)
    targetSeconds = max(60, deskSeconds)
    enabled = true
    super.init()
  }

  /// Runtime updates from the embedded web UI (and initial sync on load).
  func applyConfiguration(enabled: Bool, targetSeconds: TimeInterval) {
    let clamped = max(60, targetSeconds)
    let changed = self.enabled != enabled || self.targetSeconds != clamped
    self.enabled = enabled
    self.targetSeconds = clamped
    if changed {
      activeSeconds = 0
      reminderSent = false
    }
  }

  func currentConfiguration() -> (enabled: Bool, thresholdMinutes: Int) {
    let minutes = max(1, Int(round(targetSeconds / 60)))
    return (enabled, minutes)
  }

  func start() {
    let center = UNUserNotificationCenter.current()
    center.delegate = self
    center.requestAuthorization(options: [.alert, .sound]) { _, _ in
    }

    tickTimer?.invalidate()
    let timer = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
      self?.tick()
    }
    tickTimer = timer
    RunLoop.main.add(timer, forMode: .common)
  }

  func updatePhase(phase: String, connected: Bool) {
    let wasIdle = appPhase == "idle"
    appPhase = phase
    self.connected = connected

    let inSession =
      connected
      && (phase == "work" || phase == "before_break" || phase == "short_break"
        || phase == "long_break")
    if inSession {
      activeSeconds = 0
      reminderSent = false
      return
    }

    if connected && phase == "idle" && !wasIdle {
      activeSeconds = 0
      reminderSent = false
    }
  }

  private func secondsSinceLastInput() -> TimeInterval {
    let k = CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: .keyDown)
    let m = CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: .mouseMoved)
    let s = CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: .scrollWheel)
    return min(k, min(m, s))
  }

  private func tick() {
    guard enabled else { return }
    guard connected, appPhase == "idle" else { return }

    let idle = secondsSinceLastInput()

    if idle >= idleResetThreshold {
      activeSeconds = 0
      reminderSent = false
      return
    }

    if idle >= idlePauseThreshold {
      return
    }

    activeSeconds += 1
    if activeSeconds >= targetSeconds && !reminderSent {
      reminderSent = true
      sendReminder()
    }
  }

  private func sendReminder() {
    let minutes = max(1, Int(round(targetSeconds / 60)))
    let title = "Start a focus session?"
    let body =
      "You've been at your desk for about \(minutes) minutes without starting the Pomodoro timer."

    if NSApp.isActive {
      presentForegroundAlert(title: title, body: body)
      return
    }

    UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
      DispatchQueue.main.async {
        guard let self = self else { return }
        let fallback = { self.presentForegroundAlert(title: title, body: body) }
        switch settings.authorizationStatus {
        case .denied:
          fallback()
        default:
          self.addDeskNotificationRequest(title: title, body: body) { error in
            if error != nil {
              fallback()
            }
          }
        }
      }
    }
  }

  private func presentForegroundAlert(title: String, body: String) {
    NSApp.activate(ignoringOtherApps: true)
    hostWindow?.makeKeyAndOrderFront(nil)

    let alert = NSAlert()
    alert.messageText = title
    alert.informativeText = body
    alert.alertStyle = .informational
    alert.addButton(withTitle: "OK")

    let sheetTarget =
      hostWindow
      ?? NSApp.windows.first(where: { $0.isVisible && !$0.isSheet })
      ?? NSApp.mainWindow

    if let window = sheetTarget {
      alert.beginSheetModal(for: window, completionHandler: { _ in })
    } else {
      alert.runModal()
    }
  }

  private func addDeskNotificationRequest(
    title: String,
    body: String,
    completion: @escaping (Error?) -> Void
  ) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default

    let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
    let request = UNNotificationRequest(
      identifier: Self.notificationId,
      content: content,
      trigger: trigger
    )
    UNUserNotificationCenter.current().add(request) { error in
      DispatchQueue.main.async {
        completion(error)
      }
    }
  }
}

extension DeskReminderController: UNUserNotificationCenterDelegate {
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .sound])
  }
}
