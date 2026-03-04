#!/usr/bin/env gjs

/**
 * CSS Watcher Module
 * Monitors GTK color CSS files for changes and triggers hot reload
 * Uses Gio.FileMonitor (inotify-based) for efficient file watching
 */

imports.gi.versions.Gio = '2.0';
imports.gi.versions.GLib = '2.0';
imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Gdk = '4.0';
const { Gio, GLib, Gtk, Gdk } = imports.gi;

// CSS file paths to monitor
const GTK4_COLORS_PATH = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'gtk-4.0', 'colors.css']);
const GTK3_COLORS_PATH = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'gtk-3.0', 'colors.css']);

// CSS providers storage
let cssProviders = [];
let fileMonitors = [];
let updateTimeoutId = null;
let registeredWindows = [];
let settingsMonitor = null;

/**
 * Setup GSettings monitor for theme changes
 * This matches how native GTK4 apps detect theme changes
 */
function setupGSettingsMonitor() {
    try {
        imports.gi.versions.Gio = '2.0';
        const Gio = imports.gi.Gio;
        
        // Monitor org.gnome.desktop.interface settings
        const settings = Gio.Settings.new('org.gnome.desktop.interface');
        
        settingsMonitor = settings.connect('changed', (settings, key) => {
            if (key === 'gtk-theme' || key === 'color-scheme') {
                print(`📝 GSettings change detected: ${key}`);
                // Small delay to let file system catch up
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    reloadCSS();
                    return false;
                });
            }
        });
        
        print('✅ GSettings monitor active');
    } catch (e) {
        print('⚠️ Could not setup GSettings monitor: ' + e.message);
    }
}

/**
 * Stop GSettings monitor
 */
function stopGSettingsMonitor() {
    if (settingsMonitor) {
        try {
            imports.gi.versions.Gio = '2.0';
            const Gio = imports.gi.Gio;
            const settings = Gio.Settings.new('org.gnome.desktop.interface');
            settings.disconnect(settingsMonitor);
            print('✅ GSettings monitor stopped');
        } catch (e) {
            // Ignore errors
        }
        settingsMonitor = null;
    }
}

/**
 * Register a window for style refresh notifications
 * @param {Gtk.Window} window - Window to refresh on CSS changes
 */
function registerWindow(window) {
    if (!registeredWindows.includes(window)) {
        registeredWindows.push(window);
    }
}

/**
 * Unregister a window
 * @param {Gtk.Window} window - Window to remove from refresh list
 */
function unregisterWindow(window) {
    const idx = registeredWindows.indexOf(window);
    if (idx >= 0) {
        registeredWindows.splice(idx, 1);
    }
}

/**
 * Force refresh all registered windows
 */
function refreshWindows() {
    for (let win of registeredWindows) {
        try {
            if (win && win.get_visible()) {
                // Force style recalculation
                const styleContext = win.get_style_context();
                if (styleContext) {
                    styleContext.invalidate();
                }
                // Queue redraw
                win.queue_draw();
            }
        } catch (e) {
            // Ignore errors on individual windows
        }
    }
}

/**
 * Reload CSS providers when color files change
 * Debounced to avoid multiple rapid reloads
 */
function reloadCSS() {
    // Debounce: cancel pending reload
    if (updateTimeoutId) {
        GLib.source_remove(updateTimeoutId);
        updateTimeoutId = null;
    }

    // Schedule reload after short delay
    updateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
        print('🎨 CSS file changed, reloading theme colors...');

        try {
            // Remove old providers
            for (let provider of cssProviders) {
                try {
                    Gtk.StyleContext.remove_provider_for_display(
                        Gdk.Display.get_default(),
                        provider
                    );
                } catch (e) {
                    // Ignore errors on removal
                }
            }
            cssProviders = [];

            // Reload GTK3 colors
            const gtk3Provider = new Gtk.CssProvider();
            try {
                gtk3Provider.load_from_path(GTK3_COLORS_PATH);
                Gtk.StyleContext.add_provider_for_display(
                    Gdk.Display.get_default(),
                    gtk3Provider,
                    Gtk.STYLE_PROVIDER_PRIORITY_USER
                );
                cssProviders.push(gtk3Provider);
                print('✅ GTK3 colors reloaded');
            } catch (e) {
                print('⚠️ Could not reload GTK3 colors: ' + e.message);
            }

            // Reload GTK4 colors (if exists)
            const gtk4Provider = new Gtk.CssProvider();
            try {
                if (GLib.file_test(GTK4_COLORS_PATH, GLib.FileTest.EXISTS)) {
                    gtk4Provider.load_from_path(GTK4_COLORS_PATH);
                    Gtk.StyleContext.add_provider_for_display(
                        Gdk.Display.get_default(),
                        gtk4Provider,
                        Gtk.STYLE_PROVIDER_PRIORITY_USER
                    );
                    cssProviders.push(gtk4Provider);
                    print('✅ GTK4 colors reloaded');
                }
            } catch (e) {
                print('⚠️ Could not reload GTK4 colors: ' + e.message);
            }

            // Force refresh all registered windows
            refreshWindows();

            print('✅ Theme colors hot-reloaded successfully');
        } catch (e) {
            print('❌ Error reloading CSS: ' + e.message);
        }

        updateTimeoutId = null;
        return false; // Don't repeat
    });
}

/**
 * Setup file monitors for CSS color files
 * @returns {Object} Monitor controller with start/stop methods
 */
function createCSSWatcher() {
    let monitors = [];
    let files = [];

    function setupMonitor(path) {
        if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
            print(`⚠️ CSS file not found: ${path}`);
            return null;
        }

        try {
            const file = Gio.File.new_for_path(path);
            const monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);

            // Monitor ALL change events
            monitor.connect('changed', (monitorFile, otherFile, eventType) => {
                print(`📝 File event: ${path} (event=${eventType})`);
                // Trigger reload on any change event
                reloadCSS();
            });

            print(`✅ Monitoring: ${path}`);
            return { file, monitor };
        } catch (e) {
            print(`❌ Could not monitor ${path}: ${e.message}`);
            return null;
        }
    }

    return {
        /**
         * Start watching CSS files and GSettings
         */
        start() {
            print('🔍 Starting CSS watcher...');

            // Setup GSettings monitor for theme changes
            setupGSettingsMonitor();

            // Monitor both GTK3 and GTK4 color files
            const gtk3Monitor = setupMonitor(GTK3_COLORS_PATH);
            if (gtk3Monitor) {
                monitors.push(gtk3Monitor);
                files.push(GTK3_COLORS_PATH);
            }

            const gtk4Monitor = setupMonitor(GTK4_COLORS_PATH);
            if (gtk4Monitor) {
                monitors.push(gtk4Monitor);
                files.push(GTK4_COLORS_PATH);
            }

            if (monitors.length === 0) {
                print('⚠️ No CSS files being monitored');
            } else {
                print(`✅ CSS watcher active for ${monitors.length} file(s) + GSettings`);
            }
        },

        /**
         * Stop watching CSS files and cleanup
         */
        stop() {
            print('🛑 Stopping CSS watcher...');

            // Stop GSettings monitor
            stopGSettingsMonitor();

            // Stop file monitors
            for (let mon of monitors) {
                try {
                    mon.monitor.cancel();
                } catch (e) {
                    // Ignore cancellation errors
                }
            }
            monitors = [];
            files = [];

            if (updateTimeoutId) {
                GLib.source_remove(updateTimeoutId);
                updateTimeoutId = null;
            }

            print('✅ CSS watcher stopped');
        },

        /**
         * Get list of monitored files
         * @returns {string[]} Array of file paths
         */
        getMonitoredFiles() {
            return files.slice();
        },

        /**
         * Check if watcher is active
         * @returns {boolean}
         */
        isActive() {
            return monitors.length > 0;
        }
    };
}

/**
 * Convenience function to create and start a watcher immediately
 * @returns {Object} Monitor controller
 */
function startCSSWatcher() {
    const watcher = createCSSWatcher();
    watcher.start();
    return watcher;
}

// Export functions
var exports = {
    createCSSWatcher,
    startCSSWatcher,
    reloadCSS,
    registerWindow,
    unregisterWindow,
    setupGSettingsMonitor,
    stopGSettingsMonitor,
    GTK4_COLORS_PATH,
    GTK3_COLORS_PATH
};
