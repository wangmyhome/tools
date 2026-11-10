import AppKit
import Combine
import SwiftUI
import UserNotifications

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let monitor = CodexMonitor()
    var statusItem: NSStatusItem?
    var statusUpdate: AnyCancellable?
    var hoverController: HoverRevealController?
    lazy var panel = NotchPanel(monitor: monitor)
    private var isOverlayVisible: Bool = (UserDefaults.standard.object(forKey: "overlayVisible") as? Bool) ?? true

    func applicationDidFinishLaunching(_ notification: Notification) {
        monitor.start()
        installStatusItem()
        hoverController = HoverRevealController(panel: panel)
        hoverController?.isEnabled = isOverlayVisible
        hoverController?.start()
        if isOverlayVisible {
            panel.orderFrontRegardless()
        }
        requestNotifications()
    }

    func installStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu()
        menu.autoenablesItems = false
        menu.delegate = self
        populate(menu)
        item.menu = menu
        item.button?.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .semibold)
        item.button?.title = monitor.menuBarTitle
        statusItem = item

        statusUpdate = monitor.$tick
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                self?.statusItem?.button?.title = self?.monitor.menuBarTitle ?? "○ Codex"
            }
    }

    private func populate(_ menu: NSMenu) {
        menu.removeAllItems()
        let visibility = NSMenuItem(
            title: isOverlayVisible ? "隐藏悬浮胶囊" : "显示悬浮胶囊",
            action: #selector(toggleOverlayVisibility),
            keyEquivalent: "h"
        )
        visibility.target = self
        menu.addItem(visibility)
        menu.addItem(.separator())

        let open = NSMenuItem(title: "状态面板", action: #selector(showPanel), keyEquivalent: "o")
        open.target = self
        menu.addItem(open)
        menu.addItem(.separator())

        for task in monitor.recentTasks {
            let title = "\(task.statusGlyph) \(limit(task.displayName, to: 18)) — \(task.statusLabel)"
            let row = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            row.isEnabled = false
            menu.addItem(row)
        }

        menu.addItem(.separator())
        let quit = NSMenuItem(title: "退出", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
    }

    @objc func showPanel() {
        hoverController?.expand()
    }

    @objc func toggleOverlayVisibility() {
        setOverlayVisible(!isOverlayVisible)
    }

    private func setOverlayVisible(_ visible: Bool) {
        isOverlayVisible = visible
        UserDefaults.standard.set(visible, forKey: "overlayVisible")
        hoverController?.isEnabled = visible

        if visible {
            panel.orderFrontRegardless()
        } else {
            panel.setExpanded(false, animated: false)
            panel.orderOut(nil)
        }
    }

    @objc func quit() {
        NSApp.terminate(nil)
    }

    private func limit(_ value: String, to count: Int) -> String {
        guard value.count > count else { return value }
        let prefix = String(value.prefix(count - 1))
        return prefix + "…"
    }

    func requestNotifications() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }
}

extension AppDelegate: NSMenuDelegate {
    func menuNeedsUpdate(_ menu: NSMenu) {
        populate(menu)
    }
}

final class NotchPanel: NSPanel {
    let monitor: CodexMonitor
    let state = NotchPanelState()
    var isUserDragging = false
    private static let savedFrameKey = "savedFrame"

    init(monitor: CodexMonitor) {
        self.monitor = monitor
        super.init(contentRect: NSRect(x: 0, y: 0, width: NotchPanelState.compactSize.width,
                                       height: NotchPanelState.compactSize.height),
                   styleMask: [.borderless, .nonactivatingPanel],
                   backing: .buffered, defer: false)
        isFloatingPanel = true
        level = .statusBar
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isOpaque = false
        backgroundColor = .clear
        isMovable = true
        isReleasedWhenClosed = false
        standardWindowButton(.closeButton)?.isHidden = true
        standardWindowButton(.miniaturizeButton)?.isHidden = true
        standardWindowButton(.zoomButton)?.isHidden = true
        contentView?.wantsLayer = true
        contentView?.layer?.masksToBounds = false
        hasShadow = false
        appearance = NSAppearance(named: .vibrantDark)
        isMovableByWindowBackground = true
        hidesOnDeactivate = false

        let view = DraggableHostingView(rootView: NotchSurface(monitor: monitor, state: state))
        contentView = view

        restoreFrame()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(windowDidMove),
            name: NSWindow.didMoveNotification,
            object: self
        )
    }

    func placeNearTop() {
        guard let screen = NSScreen.main else { return }
        if frame.origin == .zero {
            let x = screen.frame.midX - NotchPanelState.compactSize.width / 2
            let y = screen.frame.maxY - NotchPanelState.compactSize.height - 2
            setFrameOrigin(NSPoint(x: x, y: y))
        }
    }

    private func restoreFrame() {
        guard
            let data = UserDefaults.standard.data(forKey: Self.savedFrameKey),
            let saved = try? JSONDecoder().decode(CodableFrame.self, from: data)
        else {
            placeNearTop()
            return
        }

        var frame = self.frame
        frame.origin = NSPoint(x: saved.x, y: saved.y)
        setFrame(frame, display: true)
        clampToScreens()
    }

    @objc private func windowDidMove() {
        guard !isUserDragging else { return }
        saveFrame()
    }

    func saveFrame() {
        let value = CodableFrame(x: frame.origin.x, y: frame.origin.y)
        if let data = try? JSONEncoder().encode(value) {
            UserDefaults.standard.set(data, forKey: Self.savedFrameKey)
        }
    }

    private func clampToScreens() {
        let frames = NSScreen.screens.map(\.frame)
        guard !frames.isEmpty else { return }
        let visible = frames.reduce(frames[0]) { $0.union($1) }
        var target = frame.origin
        target.x = min(max(target.x, visible.minX + 8), visible.maxX - frame.width - 8)
        target.y = min(max(target.y, visible.minY + 8), visible.maxY - frame.height - 8)
        setFrameOrigin(target)
    }

    func setExpanded(_ expanded: Bool, animated: Bool = true) {
        guard let screen = NSScreen.main, state.isExpanded != expanded else { return }
        state.isExpanded = expanded

        let size = expanded ? NotchPanelState.expandedSize : NotchPanelState.compactSize
        var frame = self.frame
        frame.size = size
        frame.origin.x = min(max(frame.origin.x, screen.frame.minX + 8), screen.frame.maxX - size.width - 8)
        frame.origin.y = min(max(frame.origin.y, screen.frame.minY + 8), screen.frame.maxY - size.height - 8)

        if animated {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = expanded ? 0.18 : 0.14
                context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                context.allowsImplicitAnimation = true
                animator().setFrame(frame, display: true)
            saveFrame()
            }
        } else {
            setFrame(frame, display: true)
            saveFrame()
        }
    }
}

final class DraggableHostingView: NSHostingView<NotchSurface> {
    private var dragStartedAt = Date.distantPast
    private var dragStartLocationOnScreen = NSPoint.zero
    private var isNativeDragging = false

    override func mouseDown(with event: NSEvent) {
        guard event.type == .leftMouseDown, !isNativeDragging else { return }

        isNativeDragging = true
        dragStartedAt = Date()
        dragStartLocationOnScreen = NSEvent.mouseLocation
        (window as? NotchPanel)?.isUserDragging = true

        window?.performDrag(with: event)

        isNativeDragging = false
        (window as? NotchPanel)?.isUserDragging = false
        (window as? NotchPanel)?.saveFrame()

        let locationOnScreen = NSEvent.mouseLocation
        let deltaX = locationOnScreen.x - dragStartLocationOnScreen.x
        let deltaY = locationOnScreen.y - dragStartLocationOnScreen.y
        let elapsed = Date().timeIntervalSince(dragStartedAt)

        if abs(deltaX) < 4, abs(deltaY) < 4, elapsed < 0.45 {
            rootView.state.isExpanded.toggle()
        }
    }
}

private struct CodableFrame: Codable {
    let x: CGFloat
    let y: CGFloat
}

@MainActor
final class NotchPanelState: ObservableObject {
    static let compactSize = NSSize(width: 236, height: 36)
        static let expandedSize = NSSize(width: 520, height: 194)
    @Published var isExpanded = false
}

@MainActor
final class HoverRevealController {
    private weak var panel: NotchPanel?
    var isEnabled = true
    private var pollTimer: Timer?
    private var hideTask: Task<Void, Never>?
    private let hotZoneWidth: CGFloat = 260
    private let hotZoneHeight: CGFloat = 26
    private let hideDelay: TimeInterval = 2.2

    init(panel: NotchPanel) {
        self.panel = panel
    }

    func start() {
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.update()
            }
        }
    }

    func expand() {
        guard isEnabled else { return }
        hideTask?.cancel()
        hideTask = nil
        panel?.orderFrontRegardless()
        panel?.setExpanded(true)
    }

    private func collapse() {
        hideTask?.cancel()
        hideTask = nil
        panel?.setExpanded(false)
    }

    private func update() {
        guard isEnabled, let panel, !panel.isUserDragging, let screen = NSScreen.main else { return }
        let mouse = NSEvent.mouseLocation
        let inHotZone = mouse.y > screen.frame.maxY - hotZoneHeight
            && abs(mouse.x - screen.frame.midX) <= hotZoneWidth / 2

        if inHotZone {
            expand()
        } else if panel.isVisible {
            scheduleHide()
        }
    }

    private func scheduleHide() {
        guard hideTask == nil else { return }
        hideTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(2_200_000_000))
            guard !Task.isCancelled else { return }
            self?.hideIfCursorOutside()
        }
    }

    private func hideIfCursorOutside() {
        hideTask = nil
        guard let panel else { return }
        let hoverFrame = panel.frame.insetBy(dx: -16, dy: -16)
        if !hoverFrame.contains(NSEvent.mouseLocation) {
            panel.setExpanded(false)
        }
    }
}

@main
enum AppBootstrap {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}
