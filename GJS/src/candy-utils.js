imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Gio = '2.0';
imports.gi.versions.GLib = '2.0';
imports.gi.versions.Gdk = '4.0';
const { Gtk, Gio, GLib, Gdk } = imports.gi;

const scriptDir = GLib.path_get_dirname(imports.system.programInvocationName);
imports.searchPath.unshift(scriptDir);

const Weather = imports.weather;

function createCandyUtilsBox() {
    // Load user GTK color theme CSS (if available)
    const userColorsProvider = new Gtk.CssProvider();
    try {
        userColorsProvider.load_from_path(GLib.build_filenamev([GLib.get_home_dir(), '.config', 'gtk-3.0', 'colors.css']));
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            userColorsProvider,
            Gtk.STYLE_PROVIDER_PRIORITY_USER
        );
    } catch (e) {
        // Ignore if not found
    }

    // Inject custom CSS for gradient background and frame (no neon border)
    const cssProvider = new Gtk.CssProvider();
    let css = `
        .candy-utils-frame {
            border-radius: 10px;
            min-width: 600px;
            min-height: 320px;
            padding: 0px 0px;
            box-shadow: 0 4px 32px 0 rgba(0,0,0,0.22);
            background: linear-gradient(45deg, @source_color 0%, @background 100%, #9558e1 0%, #16121a 100%);
            background-size: cover;
        }
        .weather-temp {
            font-size: 1.8em;
            font-weight: 700;
            color: @source_color;
            text-shadow: 0 0 12px @source_color;
            opacity: 1;
        }
        .neon-highlight, button:hover, button:active {
            box-shadow: 0 0 8px 2px @background, 0 0 0 2px @background inset;
            border-color: @source_color;
            color: @source_color;
        }
    `;
    cssProvider.load_from_data(css, css.length);
    Gtk.StyleContext.add_provider_for_display(
        Gdk.Display.get_default(),
        cssProvider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
    );

    // Main horizontal layout: left (hyprsunset, hyprpicker, toggles), right (presets, weather)
    const mainRow = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 32,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        margin_top: 16,
        margin_bottom: 16,
        margin_start: 16,
        margin_end: 16
    });
    mainRow.add_css_class('candy-utils-frame');

    // Left: Hyprsunset, Hyprpicker, Toggles
    const leftBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 16,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER
    });
    // Hyprsunset controls
    const hyprsunsetBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, halign: Gtk.Align.CENTER });
    let hyprsunsetEnabled = false;
    const hyprsunsetBtn = new Gtk.Button({ label: 'Hyprsunset 󰹏' });
    hyprsunsetBtn.connect('clicked', () => {
        if (!hyprsunsetEnabled) {
            GLib.spawn_command_line_async("bash -c 'hyprsunset &'");
            hyprsunsetBtn.set_label('Hyprsunset 󰛨');
            hyprsunsetBtn.add_css_class('neon-highlight');
            hyprsunsetEnabled = true;
        } else {
            GLib.spawn_command_line_async('pkill hyprsunset');
            hyprsunsetBtn.set_label('Hyprsunset 󰹏');
            hyprsunsetBtn.remove_css_class('neon-highlight');
            hyprsunsetEnabled = false;
        }
    });
    const gammaDecBtn = new Gtk.Button({ label: 'Gamma -10%' });
    gammaDecBtn.connect('clicked', () => {
        GLib.spawn_command_line_async('hyprctl hyprsunset gamma -10');
    });
    const gammaIncBtn = new Gtk.Button({ label: 'Gamma +10%' });
    gammaIncBtn.connect('clicked', () => {
        GLib.spawn_command_line_async('hyprctl hyprsunset gamma +10');
    });
    hyprsunsetBox.append(hyprsunsetBtn);
    hyprsunsetBox.append(gammaDecBtn);
    hyprsunsetBox.append(gammaIncBtn);
    leftBox.append(hyprsunsetBox);

    // Hyprpicker button
    const hyprpickerBtn = new Gtk.Button({ label: 'Launch Hyprpicker' });
    hyprpickerBtn.connect('clicked', () => {
        GLib.spawn_command_line_async('hyprpicker');
    });
    leftBox.append(hyprpickerBtn);

    // Toggles
    const togglesBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER
    });
    function addToggleRow(label, incScript, decScript) {
        const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER });
        const lbl = new Gtk.Label({ label, halign: Gtk.Align.END, xalign: 1 });
        lbl.set_size_request(110, -1);
        const decBtn = new Gtk.Button({ label: '-' });
        decBtn.set_size_request(32, 32);
        const incBtn = new Gtk.Button({ label: '+' });
        incBtn.set_size_request(32, 32);
        decBtn.connect('clicked', () => {
            GLib.spawn_command_line_async(`bash -c '$HOME/.config/hyprcandy/hooks/${decScript}'`);
        });
        incBtn.connect('clicked', () => {
            GLib.spawn_command_line_async(`bash -c '$HOME/.config/hyprcandy/hooks/${incScript}'`);
        });
        row.append(lbl);
        row.append(decBtn);
        row.append(incBtn);
        togglesBox.append(row);
    }
    addToggleRow('Icon Size', 'nwg_dock_icon_size_increase.sh', 'nwg_dock_icon_size_decrease.sh');
    addToggleRow('Dock Radius', 'nwg_dock_border_radius_increase.sh', 'nwg_dock_border_radius_decrease.sh');
    addToggleRow('Dock Width', 'nwg_dock_border_width_increase.sh', 'nwg_dock_border_width_decrease.sh');
    addToggleRow('Gaps OUT', 'hyprland_gaps_out_increase.sh', 'hyprland_gaps_out_decrease.sh');
    addToggleRow('Gaps IN', 'hyprland_gaps_in_increase.sh', 'hyprland_gaps_in_decrease.sh');
    addToggleRow('Border', 'hyprland_border_increase.sh', 'hyprland_border_decrease.sh');
    addToggleRow('Rounding', 'hyprland_rounding_increase.sh', 'hyprland_rounding_decrease.sh');
    leftBox.append(togglesBox);
    mainRow.append(leftBox);

    // Right: Presets and weather
    const rightBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 16,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER
    });
    // Preset buttons
    const presetBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4, halign: Gtk.Align.CENTER });
    const dockPresets = ['minimal', 'balanced', 'prominent', 'hidden'];
    dockPresets.forEach(preset => {
        let btn = new Gtk.Button({ label: `Dock: ${preset.charAt(0).toUpperCase() + preset.slice(1)}` });
        btn.connect('clicked', () => {
            GLib.spawn_command_line_async(`bash -c '$HOME/.config/hyprcandy/hooks/nwg_dock_presets.sh ${preset}'`);
        });
        presetBox.append(btn);
    });
    const hyprPresets = ['minimal', 'balanced', 'spacious', 'zero'];
    hyprPresets.forEach(preset => {
        let btn = new Gtk.Button({ label: `Hypr: ${preset.charAt(0).toUpperCase() + preset.slice(1)}` });
        btn.connect('clicked', () => {
            GLib.spawn_command_line_async(`bash -c '$HOME/.config/hyprcandy/hooks/hyprland_gap_presets.sh ${preset}'`);
        });
        presetBox.append(btn);
    });
    rightBox.append(presetBox);

    // Weather box at the bottom
    const weatherBox = Weather.createWeatherBoxForEmbed();
    // Add neon to temp label if possible
    try {
        // Find the temp label by class
        let children = weatherBox.get_children ? weatherBox.get_children() : weatherBox.get_children;
        if (children && children.length > 0) {
            for (let child of children) {
                if (child.get_css_classes && child.get_css_classes().indexOf('weather-temp') !== -1) {
                    child.add_css_class('weather-temp');
                }
            }
        }
    } catch (e) {}
    rightBox.append(weatherBox);

    mainRow.append(rightBox);
    return mainRow;
}

var exports = {
    createCandyUtilsBox
}; 