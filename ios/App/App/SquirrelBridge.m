#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

/**
 The registration Capacitor reads at launch.

 Swift alone is not enough: Capacitor discovers plugins through the Objective-C
 runtime, so a plugin without this file compiles cleanly, ships, and is simply
 absent at runtime — `Capacitor.Plugins.SquirrelBridge` comes back undefined and
 the web layer decides there is no native side. It is the quietest way to lose a
 feature in a Capacitor app.
 */
CAP_PLUGIN(SquirrelBridge, "SquirrelBridge",
           CAP_PLUGIN_METHOD(writeWidget, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(widgetAvailable, CAPPluginReturnPromise);
)
