import AppKit
import WebKit

@main
enum PomodoroTogglMain {
  static func main() {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.run()
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  private var window: NSWindow?
  private let deskReminder = DeskReminderController()
  private lazy var pomodoroBridge = PomodoroBridge(deskReminder: deskReminder)

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)

    let rect = NSRect(x: 0, y: 0, width: 440, height: 780)
    let window = NSWindow(
      contentRect: rect,
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    self.window = window
    window.title = "Pomodoro × Toggl"
    window.minSize = NSSize(width: 360, height: 560)
    window.center()

    let useDevServer =
      ProcessInfo.processInfo.environment["POMODORO_USE_DEV"] == "1"
      || ProcessInfo.processInfo.environment["POMODORO_USE_DEV"] == "true"

    let config = WKWebViewConfiguration()
    config.userContentController.add(pomodoroBridge, name: "pomodoro")

    if !useDevServer {
      guard
        let indexURL = Bundle.module.url(
          forResource: "index",
          withExtension: "html",
          subdirectory: "dist"
        )
      else {
        fatalError(
          "Web bundle missing. From the project root run:\n  npm run build && ./scripts/copy-web.sh"
        )
      }
      let distURL = indexURL.deletingLastPathComponent()
      config.setURLSchemeHandler(
        AppSchemeHandler(distURL: distURL),
        forURLScheme: "app"
      )
    }

    let webView = WKWebView(frame: .zero, configuration: config)
    pomodoroBridge.webView = webView
    webView.translatesAutoresizingMaskIntoConstraints = false

    let container = NSView(frame: window.contentLayoutRect)
    container.translatesAutoresizingMaskIntoConstraints = false
    window.contentView = container
    container.addSubview(webView)

    NSLayoutConstraint.activate([
      webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      webView.topAnchor.constraint(equalTo: container.topAnchor),
      webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
    ])

    if useDevServer {
      let u = URL(string: "http://127.0.0.1:5173/")!
      webView.load(URLRequest(url: u))
    } else {
      let u = URL(string: "app://localhost/index.html")!
      webView.load(URLRequest(url: u))
    }

    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)

    deskReminder.start()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }
}
