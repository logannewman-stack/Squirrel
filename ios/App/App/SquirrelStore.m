#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

/**
 The registration Capacitor reads at launch.

 Same trap as `SquirrelBridge.m`: Capacitor finds plugins through the
 Objective-C runtime, so the Swift file alone compiles, ships, and is simply
 absent — `registerPlugin("SquirrelStore")` returns an object whose every call
 rejects, and the app quietly decides the App Store is unavailable. On this
 plugin that failure mode is worse than a missing feature: it is a paid app
 that cannot take money.
 */
CAP_PLUGIN(SquirrelStore, "SquirrelStore",
           CAP_PLUGIN_METHOD(available, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(products, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(purchase, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(restore, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(current, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(finish, CAPPluginReturnPromise);
)
