//go:build darwin && cgo

#import <Cocoa/Cocoa.h>

void sshGoSetAppearance(int mode) {
    // Wails RPCs run on Go goroutines; AppKit must be updated on the main queue.
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            if (@available(macOS 10.14, *)) {
                NSAppearance *appearance = nil;
                if (mode == 1) {
                    appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
                } else if (mode == 2) {
                    appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
                }
                [NSApp setAppearance:appearance];
            }
        }
    });
}
