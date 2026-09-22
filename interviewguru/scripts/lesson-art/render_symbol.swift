import AppKit
// Kullanım: swift render_symbol.swift <sembol> <çıktı.png> <boyut>
let args = CommandLine.arguments
let name = args[1], out = args[2], size = CGFloat(Double(args[3]) ?? 512)
guard let base = NSImage(systemSymbolName: name, accessibilityDescription: nil) else { print("sembol yok: \(name)"); exit(1) }
let config = NSImage.SymbolConfiguration(pointSize: size * 0.7, weight: .semibold)
guard let img = base.withSymbolConfiguration(config) else { exit(1) }
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let r = NSRect(x: 0, y: 0, width: size, height: size)
// Beyaz tek renk: şablon görüntüyü boyayarak çiz
let tinted = img.copy() as! NSImage
tinted.lockFocus(); NSColor.white.set(); NSRect(origin: .zero, size: tinted.size).fill(using: .sourceAtop); tinted.unlockFocus()
let s = tinted.size; let scale = min(size / s.width, size / s.height) * 0.9
let drawRect = NSRect(x: (size - s.width * scale) / 2, y: (size - s.height * scale) / 2, width: s.width * scale, height: s.height * scale)
tinted.draw(in: drawRect, from: NSRect(origin: .zero, size: s), operation: .sourceOver, fraction: 1)
_ = r
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("ok \(name)")
