#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

/**
 The registration Capacitor reads at launch.

 Without it the Swift class above compiles and ships and is never found, the
 web layer sees no `__SQUIRREL_EVENTKIT__`, and Apple Calendar sync reports
 "not available on this device" on a device where it is perfectly available.
 */
CAP_PLUGIN(SquirrelCalendar, "SquirrelCalendar",
           CAP_PLUGIN_METHOD(available, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(requestAccess, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(calendars, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(events, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(save, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(remove, CAPPluginReturnPromise);
)
