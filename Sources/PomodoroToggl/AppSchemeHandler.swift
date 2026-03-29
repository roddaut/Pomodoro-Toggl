import Foundation
import WebKit

/// Serves the Vite `dist` folder at `app://localhost/…` and proxies `/api/toggl/*` to Toggl Track.
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
  private let distURL: URL
  private let lock = NSLock()
  private var dataTasks: [ObjectIdentifier: URLSessionDataTask] = [:]

  init(distURL: URL) {
    self.distURL = distURL
  }

  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    guard let url = urlSchemeTask.request.url else {
      urlSchemeTask.didFailWithError(
        NSError(
          domain: "PomodoroToggl", code: 0,
          userInfo: [NSLocalizedDescriptionKey: "Missing URL"]))
      return
    }

    let path = url.path

    if path.hasPrefix("/api/toggl") {
      proxyToggl(urlSchemeTask: urlSchemeTask, path: path, originalURL: url)
      return
    }

    serveStatic(urlSchemeTask: urlSchemeTask, path: path)
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
    let id = ObjectIdentifier(urlSchemeTask)
    lock.lock()
    dataTasks[id]?.cancel()
    dataTasks.removeValue(forKey: id)
    lock.unlock()
  }

  private func proxyToggl(
    urlSchemeTask: WKURLSchemeTask,
    path: String,
    originalURL: URL
  ) {
    let tail = path.dropFirst("/api/toggl".count)
    let normalized = tail.hasPrefix("/") ? String(tail) : "/" + tail
    var components = URLComponents()
    components.scheme = "https"
    components.host = "api.track.toggl.com"
    components.path = "/api" + normalized
    if let q = originalURL.query, !q.isEmpty {
      components.query = q
    }
    guard let upstream = components.url else {
      urlSchemeTask.didFailWithError(
        NSError(
          domain: "PomodoroToggl", code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Bad proxy URL"]))
      return
    }

    var req = URLRequest(url: upstream)
    req.httpMethod = urlSchemeTask.request.httpMethod ?? "GET"
    if let incoming = urlSchemeTask.request.allHTTPHeaderFields {
      for (key, value) in incoming {
        let lower = key.lowercased()
        if lower == "host" { continue }
        if lower == "connection" { continue }
        req.setValue(value, forHTTPHeaderField: key)
      }
    }
    req.httpBody = urlSchemeTask.request.httpBody

    let task = URLSession.shared.dataTask(with: req) { [weak self] data, response, error in
      guard let self else { return }
      if let error {
        urlSchemeTask.didFailWithError(error)
        self.removeTask(urlSchemeTask)
        return
      }
      guard let http = response as? HTTPURLResponse else {
        urlSchemeTask.didFailWithError(
          NSError(
            domain: "PomodoroToggl", code: 2,
            userInfo: [NSLocalizedDescriptionKey: "Invalid response"]))
        self.removeTask(urlSchemeTask)
        return
      }

      let headers = http.allHeaderFields.reduce(into: [String: String]()) { acc, pair in
        if let k = pair.key as? String, let v = pair.value as? String {
          acc[k] = v
        }
      }
      guard
        let res = HTTPURLResponse(
          url: urlSchemeTask.request.url ?? upstream,
          statusCode: http.statusCode,
          httpVersion: "HTTP/1.1",
          headerFields: headers
        )
      else {
        urlSchemeTask.didFailWithError(
          NSError(
            domain: "PomodoroToggl", code: 3,
            userInfo: [NSLocalizedDescriptionKey: "Could not build response"]))
        self.removeTask(urlSchemeTask)
        return
      }

      urlSchemeTask.didReceive(res)
      if let data, !data.isEmpty {
        urlSchemeTask.didReceive(data)
      }
      urlSchemeTask.didFinish()
      self.removeTask(urlSchemeTask)
    }

    lock.lock()
    dataTasks[ObjectIdentifier(urlSchemeTask)] = task
    lock.unlock()
    task.resume()
  }

  private func removeTask(_ urlSchemeTask: WKURLSchemeTask) {
    let id = ObjectIdentifier(urlSchemeTask)
    lock.lock()
    dataTasks.removeValue(forKey: id)
    lock.unlock()
  }

  private func serveStatic(urlSchemeTask: WKURLSchemeTask, path: String) {
    let relative: String
    if path.isEmpty || path == "/" {
      relative = "index.html"
    } else {
      relative = String(path.dropFirst())
    }

    let fileURL = distURL.appendingPathComponent(relative)
    let base = distURL.standardizedFileURL.path
    let target = fileURL.standardizedFileURL.path
    guard target.hasPrefix(base + "/") || target == base else {
      fail(urlSchemeTask, message: "Invalid path")
      return
    }

    guard FileManager.default.fileExists(atPath: fileURL.path) else {
      fail(urlSchemeTask, message: "Not found: \(relative)")
      return
    }

    do {
      let data = try Data(contentsOf: fileURL)
      let mime = Self.mimeType(for: fileURL.pathExtension)
      let headers = [
        "Content-Type": mime,
        "Content-Length": "\(data.count)",
      ]
      guard
        let res = HTTPURLResponse(
          url: urlSchemeTask.request.url!,
          statusCode: 200,
          httpVersion: "HTTP/1.1",
          headerFields: headers
        )
      else {
        fail(urlSchemeTask, message: "Response build failed")
        return
      }
      urlSchemeTask.didReceive(res)
      urlSchemeTask.didReceive(data)
      urlSchemeTask.didFinish()
    } catch {
      urlSchemeTask.didFailWithError(error)
    }
  }

  private func fail(_ urlSchemeTask: WKURLSchemeTask, message: String) {
    urlSchemeTask.didFailWithError(
      NSError(
        domain: "PomodoroToggl", code: 404,
        userInfo: [NSLocalizedDescriptionKey: message]))
  }

  private static func mimeType(for ext: String) -> String {
    switch ext.lowercased() {
    case "html": return "text/html; charset=utf-8"
    case "js": return "application/javascript; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "svg": return "image/svg+xml"
    case "json": return "application/json"
    case "png": return "image/png"
    case "ico": return "image/x-icon"
    default: return "application/octet-stream"
    }
  }
}
