// macOS helper for scripts/qa-keyboard-probe.mjs: window list, frontmost app and real mouse clicks.
// Keys are sent with osascript System Events; this helper only observes windows and moves focus back by clicking.
//   front                 -> pid of the frontmost application
//   locked                -> 1 while the login window covers the session (screen locked), else 0
//   windows <pid>         -> JSON array of the pid's on-screen windows, front to back
//   click <x> <y>         -> left click at a global point (points, top-left origin)
import AppKit
import CoreGraphics
import Foundation

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
  FileHandle.standardError.write("usage: front | locked | windows <pid> | click <x> <y>\n".data(using: .utf8)!)
  exit(2)
}

switch arguments[1] {
case "front":
  print(NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1)
case "locked":
  let session = CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
  print((session["CGSSessionScreenIsLocked"] as? Bool) == true ? 1 : 0)
case "windows":
  let pid = Int32(arguments[2]) ?? -1
  let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
  var windows: [[String: Any]] = []
  for window in list where (window[kCGWindowOwnerPID as String] as? Int32) == pid {
    var bounds = CGRect.zero
    if let dictionary = window[kCGWindowBounds as String] as? NSDictionary, let rect = CGRect(dictionaryRepresentation: dictionary) { bounds = rect }
    windows.append([
      "id": window[kCGWindowNumber as String] as? Int ?? 0,
      "title": window[kCGWindowName as String] as? String ?? "",
      "layer": window[kCGWindowLayer as String] as? Int ?? 0,
      "x": bounds.origin.x, "y": bounds.origin.y, "w": bounds.size.width, "h": bounds.size.height,
    ])
  }
  let data = try JSONSerialization.data(withJSONObject: windows)
  print(String(data: data, encoding: .utf8)!)
case "click":
  let point = CGPoint(x: Double(arguments[2]) ?? 0, y: Double(arguments[3]) ?? 0)
  let source = CGEventSource(stateID: .hidSystemState)
  CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
  usleep(60_000)
  CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
  usleep(40_000)
  CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
default:
  FileHandle.standardError.write("unknown command \(arguments[1])\n".data(using: .utf8)!)
  exit(2)
}
