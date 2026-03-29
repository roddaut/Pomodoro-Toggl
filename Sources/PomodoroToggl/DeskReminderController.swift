import AppKit
import CoreGraphics
import Foundation

/// Counts time spent "at the desk" (recent keyboard/mouse/scroll input) while the app is idle
/// and connected to Toggl, then fires a single notification until the user starts a session or steps away.
///
/// Uses `NSUserNotificationCenter` instead of `UNUserNotificationCenter` because the latter
/// asserts when the process has no `Info.plist` / bundle identifier — typical for a SwiftPM
/// executable that is not packaged as a `.app` bundle.
final class DeskReminderController: NSObject {
  private var tickTimer: Timer?
  private var activeSeconds: Double = 0
  private var reminderSent = false
  private var appPhase: String = ""
  private var connected = false

  private let idlePauseThreshold: TimeInterval
  private let idleResetThreshold: TimeInterval
  private let targetSeconds: TimeInterval

  override init() {
    let env = ProcessInfo.processInfo.environment
    let deskSeconds = Double(env["POMODORO_DESK_SECONDS"] ?? "") ?? 600
    let idlePause = Double(env["POMODORO_DESK_IDLE_PAUSE"] ?? "") ?? 90
    let idleReset = Double(env["POMODORO_DESK_IDLE_RESET"] ?? "") ?? 120
    idlePauseThreshold = max(30, idlePause)
    idleResetThreshold = max(idlePauseThreshold + 10, idleReset)
    targetSeconds = max(60, deskSeconds)
    super.init()
  }

  func start() {
    NSUserNotificationCenter.default.delegate = self

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
    let n = NSUserNotification()
    n.identifier = "com.pomodoro-toggl.desk-reminder"
    n.title = "Start a focus session?"
    n.informativeText =
      "You've been at your desk for about \(minutes) minutes without starting the Pomodoro timer."
    n.soundName = NSUserNotificationDefaultSoundName
    NSUserNotificationCenter.default.deliver(n)
  }
}

extension DeskReminderController: NSUserNotificationCenterDelegate {
  func userNotificationCenter(
    _ center: NSUserNotificationCenter,
    shouldPresent notification: NSUserNotification
  ) -> Bool {
    true
  }
}
