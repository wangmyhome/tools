import AppKit

@main
enum IconMaker {
    static func main() {
        let size = NSSize(width: 1024, height: 1024)
        let image = NSImage(size: size)
        image.lockFocus()

        let rect = NSRect(x: 96, y: 96, width: 832, height: 832)
        NSColor.black.setFill()
        NSBezierPath(roundedRect: rect, xRadius: 192, yRadius: 192).fill()

        let border = NSBezierPath(roundedRect: rect.insetBy(dx: 10, dy: 10), xRadius: 182, yRadius: 182)
        border.lineWidth = 8
        NSColor(calibratedWhite: 1, alpha: 0.08).setStroke()
        border.stroke()

        let dot = NSRect(x: 408, y: 408, width: 208, height: 208)
        if let glow = NSGradient(colors: [
            NSColor(calibratedRed: 0.20, green: 0.84, blue: 0.90, alpha: 0.55),
            NSColor.clear
        ]) {
            glow.draw(in: NSBezierPath(ovalIn: dot.insetBy(dx: -70, dy: -70)), angle: -90)
        }

        NSColor(calibratedRed: 0.20, green: 0.84, blue: 0.90, alpha: 1).setFill()
        NSBezierPath(ovalIn: dot).fill()

        image.unlockFocus()

        guard
            let tiff = image.tiffRepresentation,
            let rep = NSBitmapImageRep(data: tiff),
            let png = rep.representation(using: .png, properties: [:])
        else {
            exit(1)
        }

        try? png.write(to: URL(fileURLWithPath: "Sources/CodexNotch/Resources/AppIcon.png"))
    }
}
