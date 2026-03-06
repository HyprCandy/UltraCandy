imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Gio = '2.0';
imports.gi.versions.GLib = '2.0';
imports.gi.versions.Gdk = '4.0';
const { Gtk, Gio, GLib, Gdk } = imports.gi;
const scriptDir = GLib.path_get_dirname(imports.system.programInvocationName);
imports.searchPath.unshift(scriptDir);

let previousCPUStats = null;
let _prevNet = { rx: 0, tx: 0, ts: 0 };
let _hasNvidiaSmi = null;

function getCPUInfo() {
    try {
        let [ok, contents] = GLib.file_get_contents('/proc/stat');
        if (!ok) return { usage: 0 };
        let lines = imports.byteArray.toString(contents).split('\n');
        let m = lines[0].match(/cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
        if (m) {
            let u=parseInt(m[1]),n=parseInt(m[2]),s=parseInt(m[3]),i=parseInt(m[4]);
            let cur = {user:u,nice:n,system:s,idle:i,total:u+n+s+i};
            let usage = 0;
            if (previousCPUStats) {
                let td=cur.total-previousCPUStats.total, id=cur.idle-previousCPUStats.idle;
                if (td>0) usage = Math.round(((td-id)/td)*100);
            }
            previousCPUStats = cur;
            return { usage };
        }
    } catch(e){}
    return { usage: 0 };
}

function getTemperatureInfo() {
    try {
        for (let i=0;i<10;i++) {
            try {
                let [tok,tc] = GLib.file_get_contents(`/sys/class/thermal/thermal_zone${i}/temp`);
                let [yok,yc] = GLib.file_get_contents(`/sys/class/thermal/thermal_zone${i}/type`);
                if (tok&&yok) {
                    let t = parseInt(imports.byteArray.toString(tc).trim())/1000;
                    let y = imports.byteArray.toString(yc).trim().toLowerCase();
                    if (t>0&&t<150&&(y.includes('cpu')||y.includes('core')||y.includes('x86_pkg')))
                        return {cpu:Math.round(t),available:true};
                }
            } catch(e){break;}
        }
        for (let i=0;i<10;i++) {
            try {
                let [ok,c] = GLib.file_get_contents(`/sys/class/thermal/thermal_zone${i}/temp`);
                if (ok) { let t=parseInt(imports.byteArray.toString(c).trim())/1000; if(t>0&&t<150) return {cpu:Math.round(t),available:true}; }
            } catch(e){break;}
        }
    } catch(e){}
    return {cpu:0,available:false};
}

function getMemoryInfo() {
    try {
        let [ok,contents] = GLib.file_get_contents('/proc/meminfo');
        if (!ok) return {used:0,total:0,available:0,swap:{used:0,total:0}};
        let lines = imports.byteArray.toString(contents).split('\n'), mi={};
        for (let l of lines) { let m=l.match(/^(\w+):\s*(\d+)\s*kB/); if(m) mi[m[1]]=parseInt(m[2])*1024; }
        let t=mi.MemTotal||0,a=mi.MemAvailable||0,st=mi.SwapTotal||0,sf=mi.SwapFree||0;
        return {used:t-a,total:t,available:a,swap:{used:st-sf,total:st}};
    } catch(e){}
    return {used:0,total:0,available:0,swap:{used:0,total:0}};
}

function getDiskInfo() {
    try {
        let [ok,stdout] = GLib.spawn_command_line_sync(
            'df -h --output=source,size,used,avail,pcent,target -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs');
        if (!ok) return [];
        let lines = imports.byteArray.toString(stdout).split('\n').slice(1), disks=[];
        for (let l of lines) {
            if (!l.trim()) continue;
            let p = l.trim().split(/\s+/);
            if (p.length>=6) disks.push({device:p[0],size:p[1],used:p[2],available:p[3],percentage:parseInt(p[4].replace('%','')),mountpoint:p[5]});
        }
        return disks;
    } catch(e){}
    return [];
}

function getGPUInfo() {
    let gpus = [];
    if (_hasNvidiaSmi===null) _hasNvidiaSmi = !!GLib.find_program_in_path('nvidia-smi');
    if (_hasNvidiaSmi) {
        try {
            let [ok,stdout] = GLib.spawn_command_line_sync('nvidia-smi --query-gpu=utilization.gpu,name,temperature.gpu --format=csv,noheader,nounits');
            if (ok&&stdout&&stdout.length>0) {
                for (let l of imports.byteArray.toString(stdout).trim().split('\n')) {
                    if (!l.trim()) continue;
                    let p=l.split(',').map(s=>s.trim());
                    gpus.push({name:(p[1]||'NVIDIA').replace(/NVIDIA\s*GeForce\s*/i,'').trim(),usage:parseInt(p[0])||0,temp:parseInt(p[2])||0,type:'nvidia'});
                }
            }
        } catch(e){}
    }
    try {
        for (let i=0;i<8;i++) {
            let bp=`/sys/class/drm/card${i}/device/gpu_busy_percent`;
            if (!GLib.file_test(bp,GLib.FileTest.EXISTS)) continue;
            let [ok,c]=GLib.file_get_contents(bp); if(!ok) continue;
            let usage=parseInt(imports.byteArray.toString(c).trim()), name='AMD GPU', temp=0;
            try { let [nok,nc]=GLib.file_get_contents(`/sys/class/drm/card${i}/device/product_name`); if(nok){let n=imports.byteArray.toString(nc).trim();if(n)name=n;} } catch(e){}
            try { let [tok,tc]=GLib.file_get_contents(`/sys/class/drm/card${i}/device/hwmon/hwmon0/temp1_input`); if(tok)temp=Math.round(parseInt(imports.byteArray.toString(tc).trim())/1000); } catch(e){}
            gpus.push({name,usage:isNaN(usage)?0:usage,temp,type:'amd'});
        }
    } catch(e){}
    try {
        for (let i=0;i<8;i++) {
            let dp=`/sys/class/drm/card${i}/device/driver`;
            if (!GLib.file_test(dp,GLib.FileTest.IS_SYMLINK)) continue;
            let [ok,out]=GLib.spawn_command_line_sync(`readlink -f ${dp}`); if(!ok) continue;
            let d=imports.byteArray.toString(out).trim();
            if ((d.includes('i915')||d.includes('xe'))&&!gpus.some(g=>g.type==='intel'))
                gpus.push({name:'Intel iGPU',usage:-1,temp:0,type:'intel'});
        }
    } catch(e){}
    return gpus;
}

function getNetworkInfo() {
    try {
        let [ok,contents] = GLib.file_get_contents('/proc/net/dev');
        if (!ok) return {rxRate:0,txRate:0};
        let lines=imports.byteArray.toString(contents).split('\n').slice(2), rx=0,tx=0;
        for (let l of lines) { if(!l.trim()) continue; let p=l.trim().split(/\s+/); if(p.length>=10&&!p[0].includes('lo:')){rx+=parseInt(p[1])||0;tx+=parseInt(p[9])||0;} }
        let now=GLib.get_monotonic_time()/1e6, dt=_prevNet.ts>0?(now-_prevNet.ts):1; if(dt<0.1)dt=1;
        let rr=_prevNet.ts>0?(rx-_prevNet.rx)/dt:0, tr=_prevNet.ts>0?(tx-_prevNet.tx)/dt:0;
        _prevNet={rx,tx,ts:now};
        return {rxRate:Math.max(0,rr),txRate:Math.max(0,tr)};
    } catch(e){}
    return {rxRate:0,txRate:0};
}

function getSystemUptime() { try { let [ok,c]=GLib.file_get_contents('/proc/uptime'); if(ok) return parseFloat(imports.byteArray.toString(c).split(' ')[0]); } catch(e){} return 0; }
function getLoadAverage() { try { let [ok,c]=GLib.file_get_contents('/proc/loadavg'); if(ok){let p=imports.byteArray.toString(c).split(' '); return [parseFloat(p[0])||0,parseFloat(p[1])||0,parseFloat(p[2])||0];} } catch(e){} return [0,0,0]; }
function formatBytes(b) { if(b===0) return '0 B'; const k=1024,s=['B','KB','MB','GB','TB'],i=Math.floor(Math.log(b)/Math.log(k)); return parseFloat((b/Math.pow(k,i)).toFixed(1))+' '+s[i]; }
function formatUptime(sec) { const d=Math.floor(sec/86400),h=Math.floor((sec%86400)/3600),m=Math.floor((sec%3600)/60); return d>0?`${d}d ${h}h ${m}m`:h>0?`${h}h ${m}m`:`${m}m`; }
function formatRate(bps) { if(bps<1024) return `${Math.round(bps)} B/s`; if(bps<1048576) return `${(bps/1024).toFixed(1)} KB/s`; return `${(bps/1048576).toFixed(1)} MB/s`; }

// ── UI ───────────────────────────────────────────────────────────────────
function createSystemMonitorBox() {
    const display = Gdk.Display.get_default();
    if (display) {
        const ucp = new Gtk.CssProvider();
        try { const cp=GLib.build_filenamev([GLib.get_home_dir(),'.config','gtk-3.0','colors.css']); if(GLib.file_test(cp,GLib.FileTest.EXISTS)){ucp.load_from_path(cp);Gtk.StyleContext.add_provider_for_display(display,ucp,Gtk.STYLE_PROVIDER_PRIORITY_USER);} } catch(e){}
        const css = new Gtk.CssProvider();
        css.load_from_data(`
            .sysmon-frame { padding: 6px; }
            .sysmon-title { font-size: 1.15em; font-weight: 700; color: @primary; margin-bottom: 6px; }
            .gauge-label { font-size: 0.78em; font-weight: 600; color: @primary; margin-top: 1px; }
            .sysmon-info { font-size: 0.82em; font-weight: 500; color: @primary; margin-top: 2px; }
        `, -1);
        Gtk.StyleContext.add_provider_for_display(display, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    }

    let _tc = {r:0.6,g:0.85,b:1.0,a:1.0};
    function _resolveColor(w) { try { const [ok,c]=w.get_style_context().lookup_color('primary'); if(ok) _tc={r:c.red,g:c.green,b:c.blue,a:c.alpha}; } catch(e){} }

    const Pango = imports.gi.Pango, PangoCairo = imports.gi.PangoCairo;
    const GSZ=78, AW=6, AS=0.75*Math.PI, AE=2.25*Math.PI;
    const _fdG = new Pango.FontDescription(); _fdG.set_family('monospace'); _fdG.set_absolute_size(15*Pango.SCALE);
    const _fdV = new Pango.FontDescription(); _fdV.set_family('monospace'); _fdV.set_weight(Pango.Weight.BOLD); _fdV.set_absolute_size(12*Pango.SCALE);
    const _fdS = new Pango.FontDescription(); _fdS.set_family('monospace'); _fdS.set_absolute_size(7*Pango.SCALE);

    function createGauge(glyph, labelText) {
        let _f=0,_v='--',_s='';
        const da = new Gtk.DrawingArea();
        da.set_content_width(GSZ); da.set_content_height(GSZ); da.set_size_request(GSZ,GSZ); da.set_halign(Gtk.Align.CENTER);
        da.set_draw_func((_w,cr,w,h) => {
            const cx=w/2,cy=h/2,r=GSZ/2-AW/2-2;
            cr.setLineWidth(AW); cr.setLineCap(1); cr.setSourceRGBA(1,1,1,0.1); cr.arc(cx,cy,r,AS,AE); cr.stroke();
            if (_f>0.005) { cr.setSourceRGBA(_tc.r,_tc.g,_tc.b,_tc.a); cr.setLineWidth(AW); cr.setLineCap(1); cr.arc(cx,cy,r,AS,AS+_f*(AE-AS)); cr.stroke(); }
            cr.setSourceRGBA(_tc.r,_tc.g,_tc.b,0.85);
            let lo=PangoCairo.create_layout(cr); lo.set_text(glyph,-1); lo.set_font_description(_fdG); let [gw,gh]=lo.get_pixel_size(); cr.moveTo(cx-gw/2,cy-gh-1); PangoCairo.show_layout(cr,lo);
            cr.setSourceRGBA(_tc.r,_tc.g,_tc.b,1.0);
            lo=PangoCairo.create_layout(cr); lo.set_text(_v,-1); lo.set_font_description(_fdV); let [vw,vh]=lo.get_pixel_size(); cr.moveTo(cx-vw/2,cy-vh/2+5); PangoCairo.show_layout(cr,lo);
            if (_s) { cr.setSourceRGBA(_tc.r,_tc.g,_tc.b,0.55); lo=PangoCairo.create_layout(cr); lo.set_text(_s,-1); lo.set_font_description(_fdS); let [sw]=lo.get_pixel_size(); cr.moveTo(cx-sw/2,cy+vh/2+3); PangoCairo.show_layout(cr,lo); }
        });
        const lbl = new Gtk.Label({label:labelText,halign:Gtk.Align.CENTER}); lbl.add_css_class('gauge-label');
        const box = new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:0,halign:Gtk.Align.CENTER}); box.append(da); box.append(lbl);
        return { widget:box, da, lbl,
            update(fr,vt,st) { let f=Math.max(0,Math.min(1,fr)); if(f!==_f||vt!==_v||(st||'')!==_s){_f=f;_v=vt;_s=st||'';da.queue_draw();} },
            setLabel(t){lbl.set_label(t);}
        };
    }

    const mainBox = new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:4,margin_top:6,margin_bottom:6,margin_start:6,margin_end:6});
    mainBox.add_css_class('sysmon-frame');
    const titleLabel = new Gtk.Label({label:'System',halign:Gtk.Align.CENTER}); titleLabel.add_css_class('sysmon-title'); mainBox.append(titleLabel);

    const flow = new Gtk.FlowBox(); flow.set_selection_mode(Gtk.SelectionMode.NONE); flow.set_homogeneous(true);
    flow.set_max_children_per_line(4); flow.set_min_children_per_line(3); flow.set_row_spacing(6); flow.set_column_spacing(6); flow.set_halign(Gtk.Align.CENTER);
    mainBox.append(flow);

    const cpuG=createGauge('󰻠','CPU'), ramG=createGauge('󰍛','RAM'), tmpG=createGauge('󰔏','Temp'), swpG=createGauge('󰾴','Swap');
    flow.append(cpuG.widget); flow.append(ramG.widget); flow.append(tmpG.widget); flow.append(swpG.widget);

    let gpuGs=[], diskGs=[], _lgc=0, _ldc=0;

    const netLbl = new Gtk.Label({label:'↓ --  ↑ --',halign:Gtk.Align.CENTER}); netLbl.add_css_class('sysmon-info');
    const upLbl = new Gtk.Label({label:'Uptime: --',halign:Gtk.Align.CENTER}); upLbl.add_css_class('sysmon-info');
    const infoBox = new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:2,halign:Gtk.Align.CENTER,margin_top:4});
    infoBox.append(netLbl); infoBox.append(upLbl); mainBox.append(infoBox);

    function updateAll() {
        let cpu=getCPUInfo(), mem=getMemoryInfo(), temp=getTemperatureInfo(), disks=getDiskInfo(), gpus=getGPUInfo(), net=getNetworkInfo(), upt=getSystemUptime(), load=getLoadAverage();
        cpuG.update(cpu.usage/100, `${cpu.usage}%`, '');
        let mp = mem.total>0 ? Math.round((mem.used/mem.total)*100) : 0;
        ramG.update(mp/100, `${mp}%`, formatBytes(mem.used));
        tmpG.update(temp.available?Math.min(temp.cpu/100,1):0, temp.available?`${temp.cpu}°C`:'N/A', '');
        let sp = mem.swap.total>0 ? Math.round((mem.swap.used/mem.swap.total)*100) : 0;
        swpG.update(sp/100, `${sp}%`, mem.swap.total>0?formatBytes(mem.swap.used):'none');

        if (gpus.length!==_lgc) {
            for (let g of gpuGs) flow.remove(g.widget); gpuGs=[]; _lgc=gpus.length;
            for (let g of gpus) { let gauge=createGauge('󰢮',g.name.length>10?g.name.substring(0,10):g.name); gpuGs.push(gauge); flow.insert(gauge.widget,4+gpuGs.length-1); }
            for (let g of diskGs) flow.remove(g.widget); diskGs=[]; _ldc=0;
        }
        for (let i=0;i<gpus.length&&i<gpuGs.length;i++) {
            let g=gpus[i]; gpuGs[i].update(g.usage>=0?g.usage/100:0, g.usage>=0?`${g.usage}%`:'N/A', g.temp>0?`${g.temp}°C`:'');
        }
        if (disks.length!==_ldc) {
            for (let g of diskGs) flow.remove(g.widget); diskGs=[]; _ldc=disks.length;
            for (let d of disks) { let ml=d.mountpoint==='/'?'/':d.mountpoint.split('/').pop()||d.mountpoint; let gauge=createGauge('󰋊',ml); diskGs.push(gauge); flow.append(gauge.widget); }
        }
        for (let i=0;i<disks.length&&i<diskGs.length;i++) diskGs[i].update(disks[i].percentage/100, `${disks[i].percentage}%`, `${disks[i].used}/${disks[i].size}`);

        netLbl.set_label(`↓ ${formatRate(net.rxRate)}  ↑ ${formatRate(net.txRate)}`);
        upLbl.set_label(`Up: ${formatUptime(upt)}  Load: ${load[0].toFixed(2)}`);
    }

    let _tid=0, _gcc=0;
    function _start() { _resolveColor(mainBox); updateAll(); if(!_tid) _tid=GLib.timeout_add(GLib.PRIORITY_DEFAULT,2000,()=>{updateAll();if(++_gcc>=5){_gcc=0;_resolveColor(mainBox);imports.system.gc();}return GLib.SOURCE_CONTINUE;}); }
    function _stop() { if(_tid){GLib.source_remove(_tid);_tid=0;} }
    mainBox.connect('map',()=>_start()); mainBox.connect('unmap',()=>_stop()); mainBox.connect('destroy',()=>_stop());
    updateAll();
    return mainBox;
}

var exports = { createSystemMonitorBox };imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Gio = '2.0';
imports.gi.versions.GLib = '2.0';
imports.gi.versions.Gdk = '4.0';
const { Gtk, Gio, GLib, Gdk } = imports.gi;

const scriptDir = GLib.path_get_dirname(imports.system.programInvocationName);
imports.searchPath.unshift(scriptDir);

// System monitor data structures
let systemData = {
    cpu: { usage: 0, cores: [], temp: 0 },
    memory: { used: 0, total: 0, available: 0, swap: { used: 0, total: 0 } },
    disk: [],
    network: { rx: 0, tx: 0, rxTotal: 0, txTotal: 0 },
    processes: [],
    uptime: 0,
    loadAvg: [0, 0, 0],
    temperature: { cpu: 0, available: false }
};

// Add this variable at the top with other system data
let previousCPUStats = null;

// Replace your getCPUInfo function with this corrected version
function getCPUInfo() {
    try {
        let [ok, contents] = GLib.file_get_contents('/proc/stat');
        if (!ok) return { usage: 0, cores: [] };
        
        let lines = imports.byteArray.toString(contents).split('\n');
        let cpuLine = lines[0];
        let match = cpuLine.match(/cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
        
        if (match) {
            let user = parseInt(match[1]);
            let nice = parseInt(match[2]);
            let system = parseInt(match[3]);
            let idle = parseInt(match[4]);
            
            let currentStats = {
                user: user,
                nice: nice,
                system: system,
                idle: idle,
                total: user + nice + system + idle
            };
            
            let usage = 0;
            
            // Calculate usage only if we have previous stats
            if (previousCPUStats) {
                let totalDiff = currentStats.total - previousCPUStats.total;
                let idleDiff = currentStats.idle - previousCPUStats.idle;
                
                if (totalDiff > 0) {
                    usage = Math.round(((totalDiff - idleDiff) / totalDiff) * 100);
                }
            }
            
            // Store current stats for next calculation
            previousCPUStats = currentStats;
            
            return { usage: usage, cores: [] };
        }
    } catch (e) {
        print('Error reading CPU info:', e);
    }
    return { usage: 0, cores: [] };
}

function getTemperatureInfo() {
    let temps = [];
    
    try {
        // Try to read from thermal zones (most common on modern systems)
        let thermalZones = [];
        for (let i = 0; i < 10; i++) { // Check up to 10 thermal zones
            let thermalPath = `/sys/class/thermal/thermal_zone${i}/temp`;
            let typePath = `/sys/class/thermal/thermal_zone${i}/type`;
            
            try {
                let [tempOk, tempContents] = GLib.file_get_contents(thermalPath);
                let [typeOk, typeContents] = GLib.file_get_contents(typePath);
                
                if (tempOk && typeOk) {
                    let tempMilliC = parseInt(imports.byteArray.toString(tempContents).trim());
                    let type = imports.byteArray.toString(typeContents).trim();
                    let tempC = tempMilliC / 1000;
                    
                    // Filter out unrealistic temperatures
                    if (tempC > 0 && tempC < 150) {
                        thermalZones.push({ type: type, temp: tempC });
                    }
                }
            } catch (e) {
                // Thermal zone doesn't exist, continue
                break;
            }
        }
        
        // Find CPU temperature from thermal zones
        for (let zone of thermalZones) {
            if (zone.type.toLowerCase().includes('cpu') || 
                zone.type.toLowerCase().includes('core') ||
                zone.type.toLowerCase().includes('x86_pkg_temp')) {
                return { cpu: Math.round(zone.temp), available: true };
            }
        }
        
        // If no CPU temp found, use the first available temperature
        if (thermalZones.length > 0) {
            return { cpu: Math.round(thermalZones[0].temp), available: true };
        }
        
    } catch (e) {
        print('Error reading thermal zones:', e);
    }
    
    try {
        // Fallback: try lm-sensors via sensors command
        let [ok, stdout] = GLib.spawn_command_line_sync('sensors -A');
        if (ok) {
            let output = imports.byteArray.toString(stdout);
            let lines = output.split('\n');
            
            for (let line of lines) {
                // Look for CPU temperature patterns
                if (line.includes('Core') || line.includes('CPU') || line.includes('Tctl')) {
                    let match = line.match(/([+-]?\d+\.?\d*).?°C/);
                    if (match) {
                        let temp = parseFloat(match[1]);
                        if (temp > 0 && temp < 150) {
                            return { cpu: Math.round(temp), available: true };
                        }
                    }
                }
            }
        }
    } catch (e) {
        print('Error reading sensors:', e);
    }
    
    try {
        // Another fallback: try hwmon
        for (let i = 0; i < 5; i++) {
            let tempPath = `/sys/class/hwmon/hwmon${i}/temp1_input`;
            let labelPath = `/sys/class/hwmon/hwmon${i}/temp1_label`;
            
            try {
                let [tempOk, tempContents] = GLib.file_get_contents(tempPath);
                if (tempOk) {
                    let tempMilliC = parseInt(imports.byteArray.toString(tempContents).trim());
                    let tempC = tempMilliC / 1000;
                    
                    if (tempC > 0 && tempC < 150) {
                        return { cpu: Math.round(tempC), available: true };
                    }
                }
            } catch (e) {
                // Continue to next hwmon
            }
        }
    } catch (e) {
        print('Error reading hwmon:', e);
    }
    
    return { cpu: 0, available: false };
}

function getMemoryInfo() {
    try {
        let [ok, contents] = GLib.file_get_contents('/proc/meminfo');
        if (!ok) return { used: 0, total: 0, available: 0, swap: { used: 0, total: 0 } };
        
        let lines = imports.byteArray.toString(contents).split('\n');
        let memInfo = {};
        
        for (let line of lines) {
            let match = line.match(/^(\w+):\s*(\d+)\s*kB/);
            if (match) {
                memInfo[match[1]] = parseInt(match[2]) * 1024; // Convert to bytes
            }
        }
        
        let total = memInfo.MemTotal || 0;
        let available = memInfo.MemAvailable || 0;
        let used = total - available;
        let swapTotal = memInfo.SwapTotal || 0;
        let swapFree = memInfo.SwapFree || 0;
        let swapUsed = swapTotal - swapFree;
        
        return {
            used: used,
            total: total,
            available: available,
            swap: { used: swapUsed, total: swapTotal }
        };
    } catch (e) {
        print('Error reading memory info:', e);
    }
    return { used: 0, total: 0, available: 0, swap: { used: 0, total: 0 } };
}

function getDiskInfo() {
    try {
        let [ok, stdout] = GLib.spawn_command_line_sync('df -h --output=source,size,used,avail,pcent,target');
        if (!ok) return [];
        
        let lines = imports.byteArray.toString(stdout).split('\n').slice(1); // Skip header
        let disks = [];
        
        for (let line of lines) {
            if (line.trim() === '') continue;
            let parts = line.trim().split(/\s+/);
            if (parts.length >= 6) {
                disks.push({
                    device: parts[0],
                    size: parts[1],
                    used: parts[2],
                    available: parts[3],
                    percentage: parseInt(parts[4].replace('%', '')),
                    mountpoint: parts[5]
                });
            }
        }
        return disks;
    } catch (e) {
        print('Error reading disk info:', e);
    }
    return [];
}

function getNetworkInfo() {
    try {
        let [ok, contents] = GLib.file_get_contents('/proc/net/dev');
        if (!ok) return { rx: 0, tx: 0, rxTotal: 0, txTotal: 0 };
        
        let lines = imports.byteArray.toString(contents).split('\n').slice(2); // Skip headers
        let totalRx = 0, totalTx = 0;
        
        for (let line of lines) {
            if (line.trim() === '') continue;
            let parts = line.trim().split(/\s+/);
            if (parts.length >= 10 && !parts[0].includes('lo:')) { // Skip loopback
                totalRx += parseInt(parts[1]) || 0;
                totalTx += parseInt(parts[9]) || 0;
            }
        }
        
        return { rx: 0, tx: 0, rxTotal: totalRx, txTotal: totalTx };
    } catch (e) {
        print('Error reading network info:', e);
    }
    return { rx: 0, tx: 0, rxTotal: 0, txTotal: 0 };
}

function getProcessList() {
    try {
        let [ok, stdout] = GLib.spawn_command_line_sync('ps aux --sort=-%cpu');
        if (!ok) return [];
        
        let lines = imports.byteArray.toString(stdout).split('\n').slice(1); // Skip header
        let processes = [];
        
        for (let i = 0; i < Math.min(lines.length, 20); i++) { // Top 20 processes
            let line = lines[i];
            if (line.trim() === '') continue;
            let parts = line.trim().split(/\s+/, 11);
            if (parts.length >= 11) {
                processes.push({
                    user: parts[0],
                    pid: parts[1],
                    cpu: parseFloat(parts[2]),
                    memory: parseFloat(parts[3]),
                    command: parts[10]
                });
            }
        }
        return processes;
    } catch (e) {
        print('Error reading process list:', e);
    }
    return [];
}

function getSystemUptime() {
    try {
        let [ok, contents] = GLib.file_get_contents('/proc/uptime');
        if (!ok) return 0;
        
        let uptime = parseFloat(imports.byteArray.toString(contents).split(' ')[0]);
        return uptime;
    } catch (e) {
        print('Error reading uptime:', e);
    }
    return 0;
}

function getLoadAverage() {
    try {
        let [ok, contents] = GLib.file_get_contents('/proc/loadavg');
        if (!ok) return [0, 0, 0];
        
        let parts = imports.byteArray.toString(contents).split(' ');
        return [
            parseFloat(parts[0]) || 0,
            parseFloat(parts[1]) || 0,
            parseFloat(parts[2]) || 0
        ];
    } catch (e) {
        print('Error reading load average:', e);
    }
    return [0, 0, 0];
}

function updateSystemData() {
    systemData.cpu = getCPUInfo();
    systemData.memory = getMemoryInfo();
    systemData.disk = getDiskInfo();
    systemData.network = getNetworkInfo();
    systemData.processes = getProcessList();
    systemData.uptime = getSystemUptime();
    systemData.loadAvg = getLoadAverage();
    systemData.temperature = getTemperatureInfo(); 
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        return `${minutes}m`;
    }
}

function createSystemMonitorBox() {
    print('🎨 Setting up CSS styling...');
    
    // Check if we have a valid display before setting up CSS
    let display;
    try {
        display = Gdk.Display.get_default();
        if (!display) {
            print('⚠️ No display available, skipping CSS setup');
        } else {
            print('✅ Display available, setting up CSS');
        }
    } catch (e) {
        print(`⚠️ Error getting display: ${e.message}`);
        display = null;
    }

    // Load user GTK color theme CSS only if display is available
    if (display) {
        const userColorsProvider = new Gtk.CssProvider();
        try {
            const colorsPath = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'gtk-3.0', 'colors.css']);
            if (GLib.file_test(colorsPath, GLib.FileTest.EXISTS)) {
                userColorsProvider.load_from_path(colorsPath);
                Gtk.StyleContext.add_provider_for_display(
                    display,
                    userColorsProvider,
                    Gtk.STYLE_PROVIDER_PRIORITY_USER
                );
                print('✅ User color theme loaded');
            } else {
                print('⚠️ User color theme not found, using defaults');
            }
        } catch (e) {
            print(`⚠️ Error loading user colors: ${e.message}`);
        }
    }

    // Custom CSS for system monitor
    if (display) {
        const cssProvider = new Gtk.CssProvider();
        let css = `
        .system-monitor-frame {
            border-radius: 6px;
            min-width: 260px;
            min-height: 300px;
            padding: 6px;
            box-shadow: 0 2px 12px 0 rgba(0,0,0,0.22);
            //background: linear-gradient(45deg, @source_color 0%, @background 100%);
            background-size: cover;
        }
        .monitor-section {
            //background: rgba(255, 255, 255, 0.05);
            background: linear-gradient(45deg, @blur_background 0%, @background 100%);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 4px;
            padding: 4px;
            margin: 1px;
        }
        .monitor-title {
            font-size: 1em;
            font-weight: 700;
            color: @primary_fixed_dim;
            text-shadow: 0 0 4px @background;
            margin-bottom: 2px;
        }
        .monitor-value {
            font-size: 1em;
            font-weight: 600;
            color: #ffffff;
            text-shadow: 0 0 3px @background;
        }
        .monitor-label {
            font-size: 0.85em;
            font-weight: 500;
            color: #f0f0f0;
            text-shadow: 0 0 2px rgba(240, 240, 240, 0.5);
        }
        .process-row {
            padding: 2px 4px;
            margin: 1px 0;
            border-radius: 3px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .high-usage {
            background: rgba(255, 107, 107, 0.5);
            border-color: rgba(255, 107, 107, 0.4);
        }
        .medium-usage {
            background: rgba(255, 193, 7, 0.5);
            border-color: rgba(255, 193, 7, 0.4);
        }
        .low-usage {
            background: rgba(76, 175, 80, 0.5);
            border-color: rgba(76, 175, 80, 0.4);
        }
        .progress-bar {
            min-height: 8px;
            margin: 4px 0;
        }
        .progress-bar progressbar {
            background: linear-gradient(45deg, @source_color 0%, @scrim 100%);
            box-shadow: 0 0 8px rgba(0, 255, 255, 0.5);
        }
        .progress-bar progressbar trough {
            background-color: rgba(255, 255, 255, 0.1);
            border-radius: 4px;
        }
        .progress-bar progressbar fill {
            background: linear-gradient(45deg, @source_color 0%, @scrim 100%);
            border-radius: 4px;
            box-shadow: 0 0 8px rgba(0, 255, 255, 0.6);
        }
        .scrolled-area {
            background: rgba(0, 0, 0, 0.1);
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        `;
        try {
            cssProvider.load_from_data(css, css.length);
            Gtk.StyleContext.add_provider_for_display(
                display,
                cssProvider,
                Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
            );
            print('✅ Custom CSS loaded successfully');
        } catch (e) {
            print(`⚠️ Error loading custom CSS: ${e.message}`);
        }
    } else {
        print('⚠️ Skipping CSS setup due to no display');
    }

    // Main container
    print('📦 Creating main container...');
    let mainBox;
    try {
        mainBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 2,
            margin_top: 4,
            margin_bottom: 4,
            margin_start: 4,
            margin_end: 4
        });
        mainBox.add_css_class('system-monitor-frame');
        print('✅ Main container created');
    } catch (e) {
        print(`❌ Error creating main container: ${e.message}`);
        throw e;
    }

    // Title
    const titleLabel = new Gtk.Label({
        label: 'System',
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.START
    });
    titleLabel.add_css_class('monitor-title');
    mainBox.append(titleLabel);

    // CPU Section - Compact
    const cpuSection = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2
    });
    cpuSection.add_css_class('monitor-section');
    
    const cpuTitle = new Gtk.Label({ label: 'CPU', halign: Gtk.Align.START });
    cpuTitle.add_css_class('monitor-title');
    
    const cpuUsageLabel = new Gtk.Label({ label: '0%', halign: Gtk.Align.START });
    cpuUsageLabel.add_css_class('monitor-value');
    
    const cpuProgress = new Gtk.ProgressBar();
    cpuProgress.add_css_class('progress-bar');
    cpuProgress.set_fraction(0.0);
    
    cpuSection.append(cpuTitle);
    cpuSection.append(cpuUsageLabel);
    cpuSection.append(cpuProgress);
    
    mainBox.append(cpuSection);

    // Memory Section - Compact
    const memorySection = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2
    });
    memorySection.add_css_class('monitor-section');
    
    const memoryTitle = new Gtk.Label({ label: 'Memory', halign: Gtk.Align.START });
    memoryTitle.add_css_class('monitor-title');
    
    const memoryUsageLabel = new Gtk.Label({ label: '0%', halign: Gtk.Align.START });
    memoryUsageLabel.add_css_class('monitor-value');
    
    const memoryProgress = new Gtk.ProgressBar();
    memoryProgress.add_css_class('progress-bar');
    memoryProgress.set_fraction(0.0);
    
    memorySection.append(memoryTitle);
    memorySection.append(memoryUsageLabel);
    memorySection.append(memoryProgress);
    
    mainBox.append(memorySection);
    
    // Temperature Section - Compact (add after memory section)
    const temperatureSection = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2
    });
    temperatureSection.add_css_class('monitor-section');
    
    const temperatureTitle = new Gtk.Label({ label: 'Temperature', halign: Gtk.Align.START });
    temperatureTitle.add_css_class('monitor-title');
    
    const temperatureLabel = new Gtk.Label({ label: '--°C', halign: Gtk.Align.START });
    temperatureLabel.add_css_class('monitor-value');
    
    const temperatureStatusLabel = new Gtk.Label({ label: 'CPU Temperature', halign: Gtk.Align.START });
    temperatureStatusLabel.add_css_class('monitor-label');
    
    temperatureSection.append(temperatureTitle);
    temperatureSection.append(temperatureLabel);
    temperatureSection.append(temperatureStatusLabel);
    
    mainBox.append(temperatureSection);

    // System Info Section - Compact
    const sysInfoSection = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2
    });
    sysInfoSection.add_css_class('monitor-section');
    
    const sysInfoTitle = new Gtk.Label({ label: 'System', halign: Gtk.Align.START });
    sysInfoTitle.add_css_class('monitor-title');
    
    const diskUsageLabel = new Gtk.Label({ label: 'Disk: --', halign: Gtk.Align.START });
    diskUsageLabel.add_css_class('monitor-value');
    
    const uptimeLabel = new Gtk.Label({ label: 'Uptime: --', halign: Gtk.Align.START });
    uptimeLabel.add_css_class('monitor-label');
    
    sysInfoSection.append(sysInfoTitle);
    sysInfoSection.append(diskUsageLabel);
    sysInfoSection.append(uptimeLabel);
    
    mainBox.append(sysInfoSection);

    // Top Process Section - Compact
    const processSection = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2
    });
    processSection.add_css_class('monitor-section');
    
    const processTitle = new Gtk.Label({ label: 'Top Process', halign: Gtk.Align.START });
    processTitle.add_css_class('monitor-title');
    
    const topProcessLabel = new Gtk.Label({ label: 'None', halign: Gtk.Align.START });
    topProcessLabel.add_css_class('monitor-value');
    
    const processCpuLabel = new Gtk.Label({ label: 'CPU: 0%', halign: Gtk.Align.START });
    processCpuLabel.add_css_class('monitor-label');
    
    processSection.append(processTitle);
    processSection.append(topProcessLabel);
    processSection.append(processCpuLabel);
    
    mainBox.append(processSection);

    // Update functions
    function updateCPUDisplay() {
        cpuUsageLabel.set_label(`${systemData.cpu.usage}%`);
        cpuProgress.set_fraction(systemData.cpu.usage / 100.0);
    }

    function updateMemoryDisplay() {
        const percentage = systemData.memory.total > 0 ? 
            Math.round((systemData.memory.used / systemData.memory.total) * 100) : 0;
        memoryUsageLabel.set_label(`${percentage}%`);
        memoryProgress.set_fraction(percentage / 100.0);
    }
    
    function updateTemperatureDisplay() {
        if (systemData.temperature.available) {
            temperatureLabel.set_label(`${systemData.temperature.cpu}°C`);
            
            // Color code based on temperature
            if (systemData.temperature.cpu > 90) {
                temperatureStatusLabel.set_label('CPU: Critical 󰈸');
                temperatureLabel.add_css_class('high-usage');
            } else if (systemData.temperature.cpu > 65) {
                temperatureStatusLabel.set_label('CPU: Hot ');
                temperatureLabel.add_css_class('medium-usage');
            } else {
                temperatureStatusLabel.set_label('CPU: Normal ');
                temperatureLabel.add_css_class('low-usage');
            }
        } else {
            temperatureLabel.set_label('N/A');
            temperatureStatusLabel.set_label('CPU: Unavailable');
        }
    }

    function updateSystemInfoDisplay() {
        // Show main disk usage (root filesystem)
        let mainDisk = systemData.disk.find(disk => disk.mountpoint === '/');
        if (mainDisk) {
            diskUsageLabel.set_label(`Disk: ${mainDisk.percentage}%`);
        } else if (systemData.disk.length > 0) {
            diskUsageLabel.set_label(`Disk: ${systemData.disk[0].percentage}%`);
        } else {
            diskUsageLabel.set_label('Disk: --');
        }
        
        uptimeLabel.set_label(`Uptime: ${formatUptime(systemData.uptime)}`);
    }

    function updateProcessDisplay() {
        // Show only the top process
        if (systemData.processes.length > 0) {
            let topProc = systemData.processes[0];
            let procName = topProc.command.length > 20 ? 
                topProc.command.substring(0, 20) + '...' : topProc.command;
            topProcessLabel.set_label(procName);
            processCpuLabel.set_label(`CPU: ${topProc.cpu.toFixed(1)}%`);
        } else {
            topProcessLabel.set_label('None');
            processCpuLabel.set_label('CPU: 0%');
        }
    }

    function updateAllDisplays() {
        updateSystemData();
        updateCPUDisplay();
        updateMemoryDisplay();
        updateTemperatureDisplay();
        updateSystemInfoDisplay();
        updateProcessDisplay();
    }

    // Initial update
    updateAllDisplays();

    // Setup periodic updates
    const updateInterval = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        updateAllDisplays();
        return true;
    });

    // Store update interval for cleanup
    mainBox._updateInterval = updateInterval;

    return mainBox;
}

// Export the function
var exports = {
    createSystemMonitorBox
};
