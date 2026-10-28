# macOS behavior and Untangle

These handwritten notes explain how Untangle is designed and record every macOS API, system feature and undocumented behavior it uses, drives, replaces, or works around, with the evidence behind each. See [COMMANDS.md](COMMANDS.md) for command IDs and default bindings.

How to read the evidence:

- **Dated observations** were measured on the user's Mac: macOS 26.6.1, one 2560×1440 display, Dock on the right. Detailed probes and historical records remain in development. These observations are not revalidated automatically for each release.
- **Code** means behavior read from `Sources/`, without a separate live measurement.
- **Untested** means it has not been measured and must not be treated as established behavior.
- System shortcuts and gestures marked with ＊ are conventional macOS defaults, not individually verified on this Mac; users may have changed them.

Terminology: a **desktop** is a macOS Space; the **Spaces bar** is the desktop strip at the top of Mission Control. **Accessibility** means the `AX…` APIs that require permission in System Settings. **Private APIs** are undocumented Apple functions or fields that can change with macOS. The default **leader key** is held right Command.

Contents: [How Untangle is built](#how-untangle-is-built) · [System features](#system-features) · [System shortcuts](#system-shortcuts) · [System signals and APIs](#system-signals-and-apis) · [Opening windows and content](#opening-windows-and-content-in-applications) · [Workspace contents](#workspace-contents-browsers-vs-code-and-documents) · [Chrome tabs](#chrome-tabs-in-the-switcher-and-search-pages) · [Menu bar rows](#menu-bar-rows-beta) · [Overlays and skins](#overlays-liquid-glass-and-skins) · [Skin packages](#skin-packages-untangleskin) · [Settings transfer](#settings-transfer) · [Software updates](#software-updates) · [Custom leader key](#custom-leader-key) · [Region collision](#region-collision-beta) · [Mission Control previews](#mission-control-desktop-previews-beta)

## How Untangle is built

This section describes the design so the rest of the notes have a map. Paths are relative to `Sources/`. Everything here is **Code** unless dated.

### Modules and the dependency rule

`Package.swift` targets macOS 26 with Swift 6.2 tools (Swift 5 language mode). Sparkle 2.10.0 is the only external package, used by the App target alone.

| Layer | Targets | Responsibility |
|---|---|---|
| Foundation | `CoreKit` | Localization (`L10n`, `Localizer`, `Resources/{en,zh-Hans}.lproj`), `TextMatcher`, `Broadcaster`, `DeadlineScheduler`, geometry, snap and grid math, key codes. No dependency on `Contracts`. |
| Contracts | `Contracts` | Protocols and value types every module shares: `FeatureModule`, `ModuleContext`, `WindowService`, `InputService`, `CaptureService`, `CommandRegistry`, `SettingsStore`, `PlacementService`, `TabGroupService`, `DesktopOwnership`, `PageService`, `CommandSpec`. |
| Shared UI | `OverlayKit` | Overlay panels, skins (Classic, Liquid Glass, cyberpunk, skin packages), the window picker, the shortcut recorder, settings controls. |
| Services | `WindowKit`, `InputKit`, `CaptureKit`, `CommandKit`, `SettingsKit` | Accessibility, WindowServer and SkyLight windows and the menu bar; the single event tap; ScreenCaptureKit thumbnails and streams; the live command registry; settings storage. |
| Features | `WindowLayout`, `TabGroups`, `Switcher`, `DockPreview`, `CommandPalette`, `Workspaces`, `Pages` | One feature each. A feature imports only `Contracts`, `CoreKit` and `OverlayKit`, never a service implementation or another feature. |
| App | `App` (the `Untangle` executable) | Composition root, status menu, menu bar rows, settings window, updates. |

`scripts/check-deps.sh` enforces the rule with a per-target import allow-list and also pins where risky symbols may appear: Accessibility calls only in `WindowKit/`, `CGEvent` taps only in `InputKit/`, ScreenCaptureKit only in `CaptureKit/`, private calls (`dlsym`, `CGS*`, `SLS*`, `CoreDock*`) only in `*/Private/` folders, and Liquid Glass APIs only in OverlayKit skin files or the App.

**Start-up.** `UntangleMain` → `AppDelegate` → `App/Composition.swift` builds the system services, installs the event tap once Accessibility is granted, and hands every feature a `ModuleContext`. `App/ModuleRunner.swift` starts modules in catalog order (WindowLayout, TabGroups, Switcher, DockPreview, CommandPalette, Workspaces, Pages), those needing no other module's service first. Modules publish services to each other (`placement`, `tabGroups`, `desktopOwnership`, `pages`) and look up late providers through closures. A module that fails to start is stopped and reported in Diagnostics; the others keep running. Modules stop in reverse order on quit.

### Commands

- Every command is a `CommandSpec` declared statically by its module (for example `WindowLayout/LayoutCommands.swift`): an id prefixed by the module, a localized title and aliases, leader sequences (keys, or "any digit"), an optional global shortcut, where it appears (leader, search, menu bar), its target (the window focused when leader mode or search opened) and whether leader mode lingers after it runs. These declarations are the defaults listed in [COMMANDS.md](COMMANDS.md).
- `CommandCatalog.validate` rejects duplicate ids, prefix conflicts, duplicate chords, titles that pinyin initials cannot find, and multi-key prefixes without a hint group. Esc is reserved.
- `CommandKit/LeaderMatcher.swift` resolves what was typed after the leader key into a command (with its digit), a prefix for the hint panel, or no match.
- `KeyOverrides` layers the user's recorded keys over the declarations. An override that clashes gives way to a declared key; global shortcuts need ⌃, ⌥ or ⌘; a chord another client holds is refused and reported, so a bad override never stops a module from starting.
- `docs/COMMANDS.md` is generated by a test from the declarations and English strings (`scripts/update-commands.sh`); a normal test run fails if it is stale, and another test checks that these notes name only declared commands.

### Input

- `InputKit/SystemEventTap.swift` is the only event tap: session level, head-inserted, able to swallow events, running on its own high-priority thread so a busy main thread never stalls typing. If macOS disables it for a slow callback it re-enables itself and resets routing state. Mouse moves are only read while someone subscribes.
- `InputRouter` is a pure state machine. A key goes, in order, to the leader trigger, the newest key capture, a short 0.5 s buffer after the leader fires, a held leader key, registered shortcuts, and otherwise on to the frontmost app.
- `LeaderDetector` supports hold (default: right ⌘), tap, chords and any modifier. A held modifier is stripped from the captured keys. While secure input is on (`IsSecureEventInputEnabled()`), modifier-based leader triggers do not fire.
- Leader mode (`CommandPalette/Leader/`) opens a key capture first, then finds the target window. Holding shows hints after 0.4 s. A lingering command keeps the mode open for the "adjustment wait" (default 1 s, 0.3–5 s), so repeating a key cycles, for example ← through 1/2, 1/3 and 2/3.
- A keyboard can never get stuck: a capture ends when nobody reads it, a swallowed key-down also swallows its repeats and key-up, and stopping ends every capture and restores the system hot keys.

### Windows, placement and tab groups

- `WindowKit/SystemWindowService` reads windows through Accessibility, uses WindowServer numbers for identity and order, and SkyLight for desktops. Private capabilities are probed at launch and degrade to public behavior when missing. Work is spread over separate queues (events, inventory, actions, menus, Dock, Mission Control).
- Frame writes (`WindowKit/Frames/`) animate at 120 Hz with one writer per app (at most four in parallel), keep only the newest pending frame per window, write size then position in whole points, and read the result back. `AXEnhancedUserInterface` is switched off during a write (Chromium and Electron apps animate writes slowly with it on) and restored afterwards.
- Window events come from per-app AX observers (retrying from 0.5 s up to 32 s), NSWorkspace notifications, inventory scans, permission polling and the Dock's Exposé notifications, all merged into one `WindowEvent` stream.
- `WindowLayout` implements `PlacementService`: every frame request is announced before it is written, so tab groups and region collision can follow it. `WindowMemory` keeps up to ten earlier frames per window for **Z**.
- Tab groups (`TabGroups/`): `TabBook` is a pure model (a window is in at most one group, a group has at least two members). Members share one area under a bar; each bar is its own overlay panel kept just above the active window and made invisible during Mission Control, App Exposé and Show Desktop. A window joins when the intersection exceeds 85% of the smaller window's area. Snapping onto a window or group, or a ⌘-drag onto a bar, also joins. Groups are restored across restarts by window number.

### Switcher, Dock previews and capture

- The switcher's shortcuts are global; starting it turns off the system ⌘Tab, ⇧⌘Tab and ⌘` hot keys (symbolic hot keys 1, 2 and 6) and saves their earlier state so a crash can be repaired at the next launch. Releasing the held modifiers chooses the window. Windows are listed most recently used first.
- Thumbnails: one still per window, then a live `SCStream` for the selection once it has rested for 150 ms. Stills are cached (64 images, 2 s), identical requests are merged, and a stream keeps only its newest frame. Without Screen Recording permission no prompt appears; cards show app icons.
- Dock previews are event-driven: mouse moves are read only while previews are on, `DockHoverMachine` is a pure state machine, Dock AX lookups run one at a time at least 50 ms apart, and loading starts at half the show delay. Dock clicks are observed, never swallowed: a press of 0.5 s or less counts as a click, and the chosen action runs 0.2 s after release so the Dock handles the release first.

### Localization, settings and tests

- Strings live in `CoreKit/Resources/{en,zh-Hans}.lproj` and switch at runtime. `TextMatcher` ranks prefix, contains, pinyin and initials matches (`.toLatin` transform: 左半屏 → "zbp").
- Each module's settings are stored as `untangle.settings.<module>` with a version and payload, migrated with a backup copy before an upgrade. `~/.untangler/settings.plist` holds the configuration keys and is authoritative at launch.
- Tests use Swift Testing with one target per module. `Tests/ContractsTesting` provides fakes for every service, and the same contract suites run against fakes and real services. Pure state machines (`InputRouter`, `LeaderDetector`, `DockHoverMachine`, `KeyOverrides`) are tested directly; live system tests run only when opted in. `scripts/check.sh` runs the dependency check, the Python export and release tests, then `swift build` and `swift test`.

## System features

| System feature | Native entry point | Untangle command or behavior | Implementation | Evidence and limits |
|---|---|---|---|---|
| Mission Control | ⌃↑＊, F3＊, swipe up＊ | No direct command. Untangle opens/closes it for desktop creation, removal, and switching to empty desktops. Tab bars hide while it is open. | Private toggle; Accessibility reads Dock's Spaces bar; Dock sends state notifications. | 2026-10-10: opens/closes 0.1–0.2 s after request. 2026-10-11: open notification about 0.27 s late, close about 0.25 s late, delaying bar hiding/restoration. Desktop operations are rejected while the user has Mission Control open (code). |
| App Exposé | ⌃↓＊, swipe down＊ | No command; tab bars hide while open. | Dock notifications. | Notifications observed on 2026-10-11. No fallback if the end notification is lost; bars may remain hidden until Mission Control next opens/closes. |
| Show Desktop | F11＊, spread gesture＊ | No command; tab bars hide while open. | Dock notifications. | Same limitation as App Exposé. User confirmed hiding/restoration worked on 2026-10-12. |
| Create desktop | Spaces bar + button | `layout.desktopNew` (D N); `workspace.open` (W digit) also creates a desktop for an unopened workspace. | Open Mission Control, press Add Desktop through Accessibility, verify the window-server desktop list. | 2026-10-10: appeared at the end within 20 ms, 9/9 successes. 2026-10-11: a new desktop's button title stayed empty briefly. D N itself was not tested in the installed App. |
| Remove desktop | Hover a desktop and click × in Mission Control＊ | `layout.desktopRemove` (D X); a workspace-owned desktop is saved and released first. | `AXRemoveDesktop` on its Spaces bar button. | 2026-10-10: 8/8 with expanded bar and 1/1 with collapsed bar. macOS moves its windows to a neighboring desktop (code comment). `liveTheCurrentDesktopCanBeRemoved` exists without a run record; installed D X remains untested. |
| Clean up empty desktops | — | `layout.desktopCleanEmpty` (D C), or search “清理所有空桌面”. Removes desktops with no expanded application windows; keeps at least one ordinary desktop per display and leaves full-screen Spaces alone. | Window-server membership plus ordered-in state, followed by guarded `AXRemoveDesktop`; rechecks after the bar settles and on retries. Before removing the current empty desktop, switches to the surviving ordinary desktop on its left, or the first other ordinary desktop on the same display. | Hidden, minimized, transparent and ordered-out windows do not block cleanup; macOS reassigns remaining windows after removal. Expanded windows on inactive or shared desktops still count. Unreadable state or membership preserves affected desktops. Desktop elements and Untangle overlays are excluded. 2026-10-21: reproduced failed removal of the current empty desktop and a leftover retry desktop. Switching away first let the live cleanup controller remove it, return to the retained desktop and close Mission Control with no extra desktops. Branch `codex/empty-desktop-landing` starts at `f1c27f3`; 2,502 tests pass. Installed App 0.0.8 preserves the current local theme and menu changes and passes 2,546 tests. Actual D C removed one current empty desktop and a batch of two empty desktops, landed on the surviving left neighbour, closed Mission Control and left no extra desktops. Evidence: `build/empty-desktop-landing-20261021/install-final/`. |
| Switch desktop | ⌃←/⌃→, enabled ⌃digit shortcuts＊, horizontal swipe＊ | `layout.desktopPrevious` (D [), `layout.desktopNext` (D ]), `layout.desktopSwitch` (D digit); optional interception of system shortcuts below. | Try synthetic Dock swipes one desktop at a time, focusing a target-desktop window, then pressing its Mission Control button. | 2026-10-12: swipe 47 ms/step versus system ⌃←/→ at 536–702 ms; live test 0.11 s out, 0.20 s back. Button switching reliable only after creating a desktop in the same Mission Control session (2026-10-10). Installed D commands untested. |
| Move window to another desktop | Drag to a screen edge or in Mission Control＊ | `layout.spaceLeft` (S ←), `layout.spaceRight` (S →), `layout.spaceNumber` (S digit); reopening workspaces moves existing windows. | Private API available since macOS 26.4, followed by window-server verification. | Requires macOS 26.4+ and Displays have separate Spaces (code). 2026-10-11: reopening a workspace moved two Finder windows to the new desktop in 0.7 s total. S commands themselves untested. |
| Full-screen Space | Green window button＊ | D [ / D ] and intercepted ⌃←/⌃→ follow the complete Space order, including full-screen apps. D digit and S digit count ordinary desktops only; full-screen Spaces cannot be deleted or receive moved windows. | Desktop-list type information. | Code and automated regression coverage for directional navigation, swipe/focus/Mission Control fallback, and deletion protection. Live full-screen switching and Spaces bar matching remain unverified. |
| Native window tiling | Drag to screen edges/menu bar, hold ⌥ while dragging; System Settings → Desktop & Dock → Windows | Untangle drag snapping and Option grid can conflict with native tiling. | Read three system settings; warn in Layout without changing them. | Code. Native tiling was off on this Mac on 2026-10-09. System-tiled windows bypass Untangle layout, so tab-group areas use the observed window frame. |
| Application switching | ⌘Tab, ⇧⌘Tab | `switcher.allWindows`, `switcher.allWindowsReverse`: switch windows rather than applications. | Disable these system hotkeys through a private API and handle them in Untangle. | Code; no timing record. 2026-10-09: with Sunlogin in front, keys went to the remote computer instead of Untangle. |
| Same-app window switching | ⌘` | `switcher.appWindows` (⌘`), `switcher.appWindowsReverse` (⇧⌘`) | Same hotkey interception. | Code; no measurement record. |
| Bring only one window forward | Click the window | Click a tab; `tabs.next` (]), `tabs.previous` ([), `tabs.select` (T digit); select in the switcher. | Private calls used by Dock; fallback activates the app and raises the window. | 2026-10-10: two temporary test apps showed only the chosen window was raised. The public fallback previously raised all app windows; that was fixed. |
| Dock icon click | Click | Dock Preview click behavior: system default, minimize current window, or hide application; applies only to the frontmost app's icon. | Observe mouse down/up without intercepting; act after Dock's normal handling. Read icon geometry through Accessibility. | Code; no measurement record. |
| Dock hover | App name and magnification | Show window thumbnails; optionally hide Dock's own app-name label. | Poll which icon is under the pointer; suppress pointer-move events in the icon region to hide labels. | 2026-10-09, right-side Dock: an 8 pt margin suppressed names and also magnification. Label suppression has no effect with Dock autohide (code). |
| Minimized-window preview | Yellow minimize button / ⌘M＊ | Dock and switcher cards can show a retained still without restoring the window or having captured it earlier. A minimized switcher selection does not start a live stream. | Public macOS 26 `SCScreenshotManager.captureScreenshot`; existing `captureImage` fallback. Normal selected windows retain live capture. | 2026-10-18: a real test window minimized before a fresh capture service returned opaque content and stayed minimized. Installed for user evaluation; everyday Apps, inactive fullscreen, multi-display and Stage Manager acceptance pending. Implementation details and test records are maintained locally. |
| Dock placement and autohide | System Settings → Desktop & Dock | Place previews next to the Dock edge. | Infer the edge from icon-list orientation; read autohide preference. | Code. This Mac had a right-side Dock, magnification on, autohide off (2026-10-09). |
| Accessibility permission | System Settings → Privacy & Security → Accessibility | Diagnostics guides permission setup. Window access, desktop operations, and key interception require it. | Public query/prompt APIs; the button opens the relevant settings page. | Code. Stable signing identity can reduce repeated authorization; actual behavior depends on system permission state. |
| Screen Recording permission | System Settings → Privacy & Security → Screen Recording | Required for switcher/Dock thumbnails. Workspace previews do not capture screenshots and do not need it. | Public query/request APIs and ScreenCaptureKit. | Code. Without permission, thumbnails are empty; other functionality remains available. |
| Launch at login | System Settings → General → Login Items | General settings toggle. | Public `SMAppService` API. | Code. When approval is needed, prompt the user to allow it in Login Items. |
| Automatically rearrange Spaces based on most recent use | System Settings → Desktop & Dock | Neither read nor changed; desktops identified by UUID, not position. | — | 2026-10-11: focusing a window switched desktops and moved the target desktop to the end of the system list. |
| Displays have separate Spaces | System Settings → Desktop & Dock | Moving between desktops and creating/removing desktops are unavailable when disabled; report the reason. | Window-server desktop list, with preference as fallback. | Code. Changing this setting requires logging in again (code comment). Disabled configuration untested. |
| Multiple displays | — | `layout.displayLeft`, `layout.displayRight`, `layout.displayUp`, `layout.displayDown` (D + arrow) | Public display enumeration; Dock swipe affects the display under the pointer. | Untested: only one display available. |
| Stage Manager | Control Center＊ | No integration. | Not handled. | Untested. |
| Screen lock and fast user switching | — | Reject desktop operations and synthetic gestures while locked; report screen locked. | Login-session state, using an undocumented lock key. | Code. Live test observed unlocked state on 2026-10-11. |
| Reduce Motion / Increase Contrast | System Settings → Accessibility → Display | Reduce Motion disables Liquid Glass and tab-bar animations; Increase Contrast adds outlines to selected glass cards and active tabs. | SwiftUI environment values. | Code; contrast screenshots exist in the appearance gallery. |
| Liquid Glass material | Native to macOS 26 | Classic and Liquid Glass appearances in Settings → General → Appearance. | Public APIs confined to skin files in `Sources/OverlayKit`. | Code. Untangle does not become the active application; tinted glass turns gray in that context, so glass is untinted (code comment). |

## System shortcuts

| Keys | System behavior | Untangle handling | Effect on the native shortcut | Restore native behavior |
|---|---|---|---|---|
| ⌘Tab, ⇧⌘Tab | Application switching | Switcher intercepts on startup and switches windows. | Private API disables system hotkeys 1 and 2. | Disable Switcher in settings and reopen Untangle, or quit. Restore the prior state; a hotkey already disabled by something else stays disabled. After a force-quit, the next launch restores first (code). |
| ⌘`, ⇧⌘` | Same-app window switching | Untangle's same-app switcher. | Same mechanism, system hotkey 6. | Same as above. |
| ⌃←, ⌃→ | Move one Space left/right | Unchanged by default. Enable Layout → Let Untangle handle desktop shortcuts to run the D [/D ] actions. | System checkboxes remain unchanged; Untangle's earlier event tap consumes keys. Whether it always wins with both enabled is untested. | Disable the toggle. The Open system desktop-shortcut settings action only opens Keyboard settings; the user changes checkboxes. |
| ⌃1 … ⌃9, ⌃0 | Switch to desktop N | Same optional handling as above; ⌃0 selects desktop 10. | Same as above. | Same as above. |
| ⌃↑ / trackpad upward swipe | Mission Control＊ | The desktop-preview option takes over ⌃↑ and, on macOS 26, complete upward swipes. | Opens with expanded previews after swipe release; see Beta limits below. | 2026-10-19 |
| ⌃↓, F11 | App Exposé, Show Desktop＊ | Not registered or intercepted; observe Dock notifications only. | Unchanged. | — |
| Right ⌘ | Normal Command modifier | Default leader: hold right Command, then enter a sequence. Captured keys are delivered to Untangle without Command. | While held as leader it is not an ordinary modifier; use left Command for normal shortcuts. | Settings → Shortcuts → Leader key: choose a right-Command tap (still Command when another key is pressed during the tap) or a chord. |
| All keys in leader mode | Input to the focused app | Captured until leader mode ends through Esc or its post-command timeout. | The app does not receive them. | Ends automatically; capture also ends when no consumer is reading, avoiding a stuck keyboard (code). |
| ⌥ + window drag | Native tiling accelerator | Option grid. | Both may resize the window. | Follow the warning and disable the native accelerator in System Settings → Desktop & Dock → Windows. |
| ⌃Space, Caps Lock | Input-source switching on this user's Mac (2026-10-09) | Leave untouched; avoid new bindings on these keys. | Unchanged. | — |

Other software: BetterAndBetter's event tap preceded Untangle's on this Mac and passed keys through unchanged on 2026-10-09.

## System signals and APIs

Public means documented Apple APIs; Accessibility means AX access to other applications, often Dock; private means undocumented functions or fields. Private calls are isolated under module `Private/` directories and detected at startup. Missing capabilities fall back to public mechanisms or report why they are unavailable. Paths below are relative to `Sources/`.

| Signal or API | Kind | Purpose | File | Evidence |
|---|---|---|---|---|
| `CoreDockSendNotification("com.apple.expose.awake", 0)` | Private | Toggle Mission Control. | `WindowKit/Private/DockNotification.swift` | 2026-10-10: 0.1–0.2 s delay; return value ignored. |
| Dock AX tree: `mc` → `mc.display` (`AXDisplayID`) → `mc.spaces` → `mc.spaces.list`, `mc.spaces.add` | Accessibility | Detect Mission Control and read desktop buttons. | `WindowKit/Dock/MissionControlReader.swift` | Exists only while open. Dock responds slowly during animation, so reads use a 1 s timeout. Sibling `mc.windows` has a button per thumbnail; unused in production, inspected during 2026-10-10 debugging. |
| `AXPress` on `mc.spaces.add` | Accessibility | Create a desktop. | `WindowKit/Dock/MissionControlReader.swift`, `WindowKit/Spaces/MissionControl.swift` | 2026-10-10: appeared within 20 ms, 9/9 successes. |
| `AXPress` on a desktop button | Accessibility | Switch to a desktop without a focusable window. | `WindowKit/Spaces/MissionControl.swift` | 2026-10-10: switched about 0.3 s after button readiness following creation. Pressing 50 ms after creation, with a collapsed bar, or after removal in the same session returned success without switching. |
| `AXRemoveDesktop` on a desktop button | Accessibility | Remove a desktop. | `WindowKit/Spaces/MissionControl.swift` | 2026-10-10: appeared in the action list about 0.2 s after creation; succeeded even when absent from the list with a collapsed bar. |
| Dock notifications `AXExposeShowAllWindows`, `AXExposeShowFrontWindows`, `AXExposeShowDesktop`, `AXExposeExit` | Accessibility | Observe overview start/end. | `WindowKit/Dock/ExposeWatcher.swift`, `ExposeObserver.swift` | 2026-10-11: start events 265–277 ms late, exit about 255 ms late. Mission Control has a 1 s polling fallback; the other two modes do not. |
| `SLSMainConnectionID`, `SLSCopyManagedDisplaySpaces` | Private | Desktop IDs, UUIDs, type, current state, and display. | `WindowKit/Private/PrivateSpaces.swift`, `WindowKit/Spaces/SpaceParser.swift` | 2026-10-10: numeric IDs last only for the login session, so identity uses UUIDs. UUID stability across reboot is untested. |
| `SLSCopySpacesForWindows` | Private | Window desktop membership, liveness, and desktop occupancy. | `WindowKit/Private/PrivateSpaces.swift`, `WindowKit/Spaces/SpaceOccupancy.swift` | 2026-10-10: closed windows belong to no Space; windows on all Spaces do not count as occupying a particular desktop. |
| `SLSBridgedMoveWindowsToManagedSpaceOperation` | Private | Move windows between desktops. | `WindowKit/Private/SpaceMover.swift`, `WindowKit/Spaces/SpaceMoves.swift` | Available since macOS 26.4 (code); successfully used in workspace reopening on 2026-10-11. |
| Synthetic Dock swipe (`CGEvent`, undocumented fields 55, 110, 123–138, etc.) | Private | Switch adjacent desktops without waiting for animation. | `WindowKit/Private/DockSwipe.swift`, `WindowKit/Spaces/DesktopSwipe.swift` | 2026-10-12: 47 ms/step. Sending does not establish success; each step is checked against the desktop list. |
| `com.apple.swipescrolldirection` preference | Public | Set swipe direction sign. | `WindowKit/Private/DockSwipe.swift` | 2026-10-12 with natural scrolling on: right +1, left −1. Inversion when off is untested. |
| `_AXUIElementGetWindow` | Private | Map AX windows to window-server IDs. | `WindowKit/Private/WindowIdentity.swift` | Code: fallback matches process, position, and title. |
| `_AXUIElementCreateWithRemoteToken` | Private | Find AX-unlisted windows on other desktops. | `WindowKit/Private/RemoteWindowFinder.swift` | Code: budget of 0.1 s per application per attempt. |
| `_SLPSSetFrontProcessWithOptions`, `SLPSPostEventRecordTo`, `GetProcessForPID` | Private | Raise and focus only the selected window; macOS switches if it is on another desktop. | `WindowKit/Private/PreciseFocus.swift` | 2026-10-10: raised only the selected window. |
| `CGSSetSymbolicHotKeyEnabled`, `CGSIsSymbolicHotKeyEnabled` | Private | Disable/restore system ⌘Tab and ⌘`. | `InputKit/Private/SymbolicHotKeys.swift`, `InputKit/SwitcherHotKeys.swift` | Code; no measurement record. |
| `CGEvent.tapCreate` (session-level, first, event-consuming) | Public | The application's single keyboard/mouse event tap. | `InputKit/SystemEventTap.swift` | Code: macOS disables slow callbacks; Accessibility permission required. |
| `NSWorkspace.activeSpaceDidChangeNotification` | Public | Observe active desktop changes. | `WindowKit/Events/WorkspaceChange.swift` | 2026-10-10: delivered after animation, about 0.55 s late. |
| `NSWorkspace` launch, terminate, hide, unhide, activate, and wake notifications; `NSApplication.didChangeScreenParametersNotification` | Public | Track apps and displays. | `WindowKit/Events/WorkspaceChange.swift` | Code. |
| AX window notifications: creation, destruction, focus, movement, resizing, minimize/restore, title | Accessibility | Track individual windows. | `WindowKit/Events/WindowNotification.swift` | Code. |
| `CGWindowListCopyWindowInfo` | Public | Enumerate window-server windows. | `WindowKit/Inventory/AXInventorySource.swift` | 2026-10-10: includes closed and hidden helper windows, including Safari's 500×500 helper; desktop membership must also be checked. |
| Window `AXDocument` | Accessibility | Capture displayed file/URL for workspace saving. | `WindowKit/Inventory/DocumentURL.swift` | 2026-10-11: Chrome reported URLs; Safari and Finder did not. |
| Application `AXEnhancedUserInterface` | Accessibility | Disable before frame writes, restore afterward. | `WindowKit/Frames/AXFrameBackend.swift`, `FrameApplier.swift` | Code. |
| Application menu bar | Accessibility | Find and invoke the app's New Window action. | `WindowKit/AX/AppMenuReader.swift`, `NewWindowMenu.swift`, `NewWindowOpener.swift` | Code: inspect only the first six menus without showing them. 2026-10-10: invocation worked without activating the app. |
| Dock icons: `AXDockItem`, `AXApplicationDockItem`, `AXIsApplicationRunning` | Accessibility | Identify icons under the pointer and their geometry. | `WindowKit/Dock/DockReader.swift`, `DockGeometry.swift` | Code. |
| Login-session `CGSSessionScreenIsLocked` | Private key in a public function's dictionary | Detect screen lock. | `WindowKit/Private/ScreenLock.swift` | Code: key absent when unlocked. |
| Preferences: `com.apple.dock`/`autohide`; `com.apple.spaces`/`spans-displays`; `com.apple.WindowManager`/`EnableTilingByEdgeDrag`, `EnableTopTilingByEdgeDrag`, `EnableTilingOptionAccelerator` | Public, read-only | Dock autohide, shared/separate display Spaces, native tiling switches. | `DockPreview/DockPreferences.swift`, `WindowKit/Spaces/SeparateSpaces.swift`, `WindowLayout/SystemTiling.swift` | Code: absent tiling keys default to enabled. |
| ScreenCaptureKit: `SCShareableContent`, `SCScreenshotManager`, `SCStream` | Public | Thumbnails and live window content. Stills try macOS 26 `captureScreenshot` first, then `captureImage` on failure or missing SDR output. | `CaptureKit/ScreenCaptureBackend.swift`, `LiveWindowCapture.swift` | Code: reuse thumbnails of the same window for 2 s; do not route by potentially stale `SCWindow.isOnScreen`. 2026-10-18: minimized fixture capture passed without a pre-minimize thumbnail; see the minimized-window entry above. |
| `AXIsProcessTrusted`, `CGPreflightScreenCaptureAccess`, `SMAppService.mainApp` | Public | Permissions and launch at login. | `WindowKit/SystemWindowService.swift`, `CaptureKit/ScreenCaptureBackend.swift`, `App/Settings/SettingsModel.swift` | Code. |
| `x-apple.systempreferences:` URLs | Public | Open Accessibility, Screen Recording, and Keyboard settings. | `App/Permissions.swift`, `WindowLayout/LayoutSettingsModel.swift` | Code. |
| App AX attribute `AXExtrasMenuBar` (fallback `kAXMenuBarAttribute` for Control Center and SystemUIServer), items with role `AXMenuBarItem` | Accessibility (undocumented attribute name) | Discover status items for menu bar rows. | `WindowKit/MenuBar/MenuBarInventory.swift` | Code: bounded walk (depth 12, 512 nodes, 128 items, 1 s). Traversal adapted from SaneBar (MIT, see NOTICE). |
| `CGSGetProcessMenuBarWindowList`, `CGSGetScreenRectForWindow`, `SLSCopyManagedDisplayForWindow` | Private | Find the real WindowServer surfaces behind status items and their displays. | `WindowKit/Private/PrivateMenuBarWindows.swift` | On macOS 26.6.1 the items are hosted by Control Center, so a surface's process is not the item's app. |
| Untangle's own `NSStatusItem`s as wide spacers; `NSStatusItem Preferred Position <name>` default plus `_sendSavedPreferredPosition` | Public length technique; private selector | Fold icons off screen; move Untangle's own spacers without input. | `WindowKit/MenuBar/MenuBarDivider.swift` | Spacer mechanism adapted from Hidden Bar (MIT, see NOTICE). AppKit clamps a requested 5120 pt length to 5016. |
| Synthetic ⌘-drag (`CGEvent` mouse down, drags, up with ⌘, posted to the session) | Synthetic events | Move another app's status item across the fold. | `WindowKit/MenuBar/MenuBarMove.swift` | 2026-10-18: row switch median 1.2 s, worst 1.4 s. The pointer is restored with a queued mouse-move event; `CGWarpMouseCursorPosition` was overwritten by queued events. |
| `CGWindowListCreateImageFromArray` (resolved at runtime) | Public C function, deprecated in the Swift SDK | Pictures of folded status items for the tray and settings. | `CaptureKit/Private/MenuBarWindowSnapshot.swift` | 2026-10-14: `SCStream` froze for off-screen items and showed the recording indicator, so it is not used here. Needs Screen Recording. |
| `AEDeterminePermissionToAutomateTarget` | Public (Apple Events) | Check Automation consent for Chrome and Safari before scripting them. | `Pages/ChromeTabs.swift`, `Workspaces/Saving/BrowserAutomation.swift` | Code: prompts only from Settings or on a manual save or restore; background autosave never prompts. |
| `NSAppleScript` handlers called with `executeAppleEvent` (`kASSubroutineEvent`) | Public (AppleScript) | List and select Chrome tabs; snapshot and restore Chrome and Safari windows. | same | Arguments travel as typed Apple Event descriptors and are never pasted into script source. 2026-10-23: about 120 ms per Chrome window; switching tabs does not reload. |
| VS Code `globalStorage/storage.json` and `workspaceStorage/*/state.vscdb` (SQLite, read-only) | File formats | Which project and local files each VS Code window shows. | `Workspaces/Saving/CodeContentCapture.swift` | Paths only, never file contents; default profile only; format depends on the VS Code version. |
| VS Code's bundled `code` CLI (`--new-window`) via `Process`; `NSWorkspace.openApplication` / `open(_:withApplicationAt:configuration:)` | Public / CLI | Reopen boards' apps, documents, folders and projects. | `Workspaces/Opening/CodeOpening.swift`, `Workspaces/Opening/SystemOpenEnvironment.swift` | Code: does not activate, add to recents or substitute another running app. |
| SwiftUI `glassEffect`, `GlassEffectContainer`; AppKit `NSGlassEffectView` | Public (macOS 26) | Liquid Glass panels, tab bars, search, and snap zones. | `OverlayKit/LiquidGlassSkin.swift` and other skin files | Code: glass is never tinted (a tint turns grey because Untangle never becomes the active app); interactive glass is off under Reduce Motion. |
| `NSPanel` with `.nonactivatingPanel` | Public | Every overlay, so the app you are using keeps focus. | `OverlayKit/OverlayPanel.swift` | Code: hidden with zero opacity and ignored mouse events, not `orderOut`. |
| `CTFontManagerRegisterFontsForURL(…, .process, …)` | Public | Fonts shipped inside skin packages, for this process only. | `OverlayKit/SkinPackage.swift` | Code: unregistered before a package is replaced or deleted. |
| `compression_decode_buffer` / `compression_encode_buffer` (zlib) and `crc32` | Public | Read and write `.untangleskin` packages and settings zips without a third-party library. | `App/Settings/SkinPackageArchive.swift` | Code: stored and Deflate entries only; rejects encryption, symbolic links and Zip64. |
| `UTExportedTypeDeclarations` and `CFBundleDocumentTypes` for `untangleskin` | Info.plist | Double-click a skin package in Finder. | `scripts/build-app.sh` | Code: the App asks before installing. |
| Sparkle `SPUStandardUpdaterController` | Third-party (Sparkle 2.10.0) | Software updates. | `App/AppUpdates.swift` | See [Software updates](#software-updates). |
| `WKWebView` with a bundled page and a main-frame-only script message handler | Public (WebKit) | Thanks and Help panel. | `App/Settings/Help/HelpSheet.swift` | Code: only the bundled document loads in the view; outside links open in the default browser. |
| SkyLight `SLSBridgedSpace…Operation` classes for creation, switching, destruction | Private | **Not used.** | — | 2026-10-10: class presence only, not exercised. Dock did not recognize desktops made by the older functions they wrap. |

### Untangle overlay window types

Defined in `Sources/OverlayKit/OverlayPanel.swift`; measured on 2026-10-11 with the development probe `Tests/AppTests/LivePanelDesktopProbe.swift`.

| `collectionBehavior` | Used by | Desktop switching | Mission Control |
|---|---|---|---|
| `[.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]` | Switcher, search, hints, Dock previews, snap previews | Present on every desktop and over full-screen windows (code). | Absent (code). |
| `[.stationary, .ignoresCycle]` | Tab bars | Remain on their desktop. | No thumbnail, but stay visibly floating at their position, so Untangle must hide them. |
| `[.transient, .ignoresCycle]` | No longer used for tab bars | If Untangle is active, switching carries the panel to the new desktop. | Absent; hidden by macOS. |
| `[.managed, .ignoresCycle]` | Unused | Remain on their desktop. | Appear as separate windows. |

- Showing a previously hidden panel on another desktop can move it there. Temporary hiding uses opacity rather than `orderOut` (2026-10-11).
- An ordinary window far outside all displays made Mission Control shrink every thumbnail to 0×0. `.stationary` and `.transient` windows did not (2026-10-10); use those types for real-window tests.
- Mission Control can be inspected without screenshots: read Dock's `mc.windows` while open. Dock logs with `process == "Dock" AND category == "missioncontrol"` recorded entry/exit (2026-10-10).

## Opening windows and content in applications

Untangle uses three paths: without content, invoke the application's New Window menu item through Accessibility; for a file/folder, pass it directly through `NSWorkspace`; for a URL, create a window first and then open the URL. These rules were measured on 2026-10-11 and live in `Sources/WindowKit/AX` and `Sources/Workspaces/Opening`. Menu matching recognizes Chinese new-window titles and “New … Window,” excludes incognito/private/profile/tab actions, and prefers ⌘N.

| Application | New Window menu item | Menu invocation | Opening content | Particular behavior |
|---|---|---|---|---|
| Finder | File → New Finder Window, ⌘N | 2026-10-10: 0.75 s, current desktop, no desktop switch, Finder becomes active. Live test passed on 2026-10-11. | Passing a folder directly creates a window on the current desktop. Creating first produces an extra window (2026-10-11). | Does not report the displayed folder. |
| Safari | File → New Personal Window, ⌘N; title contains the profile name | 2026-10-10: 1.54 s, current desktop, no desktop switch. | Create then open URL: page lands in the new window without an extra window or desktop switch (2026-10-11, user confirmed). Direct URL opening without creation: untested. | Does not report URL; has a hidden 500×500 helper window. |
| Chrome | Not recognized during the 2026-10-10 scan; invoked in the 2026-10-11 test, title not recorded | 2026-10-11: current desktop. | Direct URL opening uses a tab in an existing window and switches to its desktop. Create then open URL uses the new window (2026-10-11). | Reports URL. |
| Terminal | Shell → New Window, a profiles submenu; select its ⌘N item (code) | Untested. | Untested. | Sizes snap to character cells. If the target size is impossible, only Terminal retains a gap; within one cell (24 pt) it can join a tab group (user confirmed 2026-10-12). |
| VS Code | File → New Window, ⇧⌘N | Untested. | Untested. | New windows reposition themselves, which triggered automatic grouping on 2026-10-10. Automatic grouping now recognizes user-initiated moves only. |
| Claude, ChatGPT | Available: New Session in New Window / New Window | Untested. | Untested. | — |
| Sunlogin, Notes | No matching item | — | Untested. | When Sunlogin is frontmost, keys go to the remote computer instead of Untangle (2026-10-09). |
| Untangle itself | — | — | — | 2026-10-10: observed a screen-filling window present on every desktop. Desktop occupancy counts windows belonging only to that desktop. |

If an application already has windows elsewhere, its New Window action still opens on the current desktop for Finder (2026-10-11, `liveNewWindowsStayHereAndFocusCanSwitchDesktops`). Other apps remain untested. A full workspace expansion containing browser URL entries remains untested.

## Workspace contents: browsers, VS Code and documents

Saving a board records each window on the board's desktop (minimized, full-screen and Untangle's own windows are skipped) with its frame, display, title, document and window number, then asks content adapters what the window shows. Paths are relative to `Sources/Workspaces/`.

| App | How contents are read | How they are reopened | Limits |
|---|---|---|---|
| Chrome | AppleScript handler: each window's bounds, tab URLs, active tab index and name. Incognito windows report nothing and are marked unavailable. | `make new window`, then one tab per URL and the saved active tab. | Opening a Chrome window activates Chrome and can switch desktops (probe). |
| Safari | AppleScript handler: bounds, tab URLs, current tab index and name. Safari's script window id is its window number. | `make new document`, then new tabs; the new window is found by comparing window ids before and after. | Private windows are not specially detected (unverified). |
| VS Code | `storage.json` lists open windows with their frames and project (`configURIPath` or `folder`); `state.vscdb` lists open local file editors. | The CLI inside the app bundle: `code --new-window --skip-add-to-recently-opened -- <paths>`, killed after 10 s. | Remote windows are marked partial. Cursor position, unsaved buffers and file contents are never saved. |
| Other apps | The window's `AXDocument` (only `file`, `http` and `https` URLs are accepted). | `NSWorkspace` opens the document in that app; otherwise the app's New Window menu item is pressed. | Finder does not report the folder it shows. |

- Script results are tied to a real window by bounds (±2 pt), then title or URL; the link must be unique in both directions or the entry is marked with a capture issue.
- Each entry reports **permission**, **unavailable** or **partial** problems. A failed refresh keeps the previous contents, and contents the user edited by hand are never overwritten.
- Restoring matches open windows in order: same window number and app, same document, same title, then the only window left. Ambiguous entries stay unmatched and are opened fresh; matched windows are reused without reloading.
- A board is bound to its desktop by UUID, not by position. Windows that open elsewhere are moved with `SLSBridgedMoveWindowsToManagedSpaceOperation`.
- Autosave runs every 60 minutes by default (1–120), when you leave the board's desktop, on release and on quit, and waits 10 s after a restore. A locked board refuses saves and edits but still restores. Deleted boards stay in the trash for 7 days.
- Automation (Apple Events, asked once per browser) and Accessibility (window focus, moves, menu presses) are separate permissions.
- Evidence: the Chrome, Safari and VS Code adapters pass automated tests; native readback against the real apps has not been run.

## Chrome tabs in the switcher and search (Pages)

- `Pages/ChromeTabs.swift` asks Chrome through AppleScript for each non-incognito window's id, bounds, active tab index and every tab's id, title and URL. Chrome's window id is not a window number, but tab ids stay stable.
- AppleScript windows are matched to real windows by frame (±1 pt). Two Chrome windows with identical frames get no tab list rather than a wrong one.
- Choosing a tab sets the window's active tab index (no reload, measured 2026-10-23 with Chrome 155) and then focuses the window through Accessibility.
- Automation consent is only requested from **Settings → Pages**; until then the switcher and search simply show Chrome windows without their tabs.

## Menu bar rows (Beta)

macOS 26 has no public API to reorder or hide another app's status item. Untangle combines three techniques, all borrowed from MIT-licensed projects credited in NOTICE.

- **Finding items:** each running app's `AXExtrasMenuBar` is walked for menu bar items, and private CGS calls list the WindowServer surfaces that actually host them (on macOS 26 Control Center hosts them all). Items get a stable key from their app, identifier or label.
- **Hiding:** one Untangle status item becomes a very wide spacer, pushing everything to its left off screen. There is a single fold, not one per row; a second spacer guards the transition.
- **Switching rows:** Untangle hides the outgoing row behind the guard, then performs a real ⌘-drag on only the icons that must cross the fold, and moves its own spacers through saved positions without input. That is why the pointer is borrowed for about a second: a notice asks you not to move the mouse, real input wins, and the pointer is put back afterwards. Automatic repairs wait for 300 s without input and pause while any menu is open.
- **Settling and failure:** a move counts only when frames match on six consecutive samples. A failed switch is retried once; if that fails, every icon is shown and nothing moves again until you choose **Rearrange** or **Rebuild**. If Control Center stops showing Untangle's items, Untangle rebuilds them once and then points you to System Settings.
- **Tray pictures:** folded icons are captured with `CGWindowListCreateImageFromArray`; ScreenCaptureKit froze for off-screen items. Pictures refresh at 10 fps only while the tray is open, and an icon cache keeps pictures of apps that are not running.
- **Opening the tray:** right-click Untangle's status item or press ⌥M. ⌥⌘-drag from the menu bar into a tray row is caught by the event tap; a plain ⌘-drag is only watched so the row order can follow it.
- **Quitting** removes the spacers, which brings every icon back.
- Requires macOS 26 exactly, Accessibility and Screen Recording. Evidence comes from single-machine runs on 26.6.1; submenu hover and a pointer-jump fix were still open on 2026-10-21.

## Overlays, Liquid Glass and skins

- Every overlay is a borderless, non-activating `NSPanel`, so the app you are typing in keeps focus. Overlays join all desktops and stay out of Mission Control; tab bars instead stay on their own desktop (see [Untangle overlay window types](#untangle-overlay-window-types)).
- The **Liquid Glass** appearance paints with two bundled skin packages, a light and a dark lens, picked by the light/dark setting (`NSApp.appearance`). A source build without those packages falls back to the code-drawn glass skin. **Classic** is drawn in code.
- Glass uses the macOS 26 SwiftUI `glassEffect` (with `GlassEffectContainer` where two shapes sit together) and AppKit `NSGlassEffectView` for snap zones. It is never tinted, because Untangle never becomes the active app and tinted glass then turns grey.
- Reduce Motion removes animations and interactive glass; Increase Contrast adds outlines to the selection; Reduce Transparency is respected by skin packages.
- The skin workshop composes a skin per module (switcher, tab bar, Dock preview, search, key hints, toasts) from the glass, minimal and cyberpunk templates. A **theme file** (`untangle-theme`, JSON, at most 64 KiB) stores those choices and names packages without embedding them.

## Skin packages (`.untangleskin`)

A skin package is data only, so it installs without an App update. The format is described in [`skins/FORMAT.zh-CN.md`](../skins/FORMAT.zh-CN.md); ready-made packages live in [`skins/`](../skins/).

| Part | Rule |
|---|---|
| Container | Zip with stored or Deflate entries; no encryption, symbolic links or Zip64. Archive at most 25 MB, unpacked at most 20 MB, each file at most 10 MB, at most 200 files. |
| Files | Required: `skin.json` (at most 256 KiB) and `previews/card.png`. Optional: `assets/` (PNG or PDF, each side at most 4096 px), `fonts/` (OTF or TTF), `README.md`, `LICENSE*.txt`. |
| `skin.json` | `format: "untangle-skin"`, `formatVersion: 1` (higher versions are refused), reverse-DNS `id` (same id = update), `version`, localized `name`, `appearance` (light or dark), `tokens` referenced as `$group.name`, `editable` tokens, `roles` (panel, tabBar, tab, card, well, field, row, chip, control, dropTarget) with states and a `contrast` variant, `text`, `motion`. |
| Drawing | Layers: fill, gradient, material, image (including nine-slice), stroke, bevel, shadow, glow, pattern, box, with optional blend modes such as `plusLighter`. Shapes: rect, rounded, chamfer, parallelogram, notched. |
| Install | Unpacked into a staging folder under `~/.untangler/skins/`, validated, then moved into place (or swapped with `replaceItemAt` for an update). Fonts register for this process only. Deleting moves the package to the Trash. |

## Settings transfer

- Export writes `Untangle-settings-<date>.zip` with `manifest.json` (`format: "untangle-settings"`, version 2, app version, file list), one `modules/<id>.json` per module, and `skins/<id>.untangleskin` for installed packages. Only version 2 is read, and the manifest must match the zip exactly.
- Excluded: system permissions, launch at login, update state, caches, native menu bar positions, live windows and unsaved edits. Imported boards lose their old desktop bindings.
- **Import and Quit** stages the file in `~/Library/Application Support/Untangle/SettingsTransfer/` (owner-only permissions) and quits. On the next launch, before any service starts, current settings are backed up to a `Before-import` zip and the new ones are swapped in with rollback on failure. A marker stops a leftover file from being imported twice.

## Software updates

- Sparkle 2.10.0 reads `appcast.xml` from the latest GitHub release. The feed must be signed (`SURequireSignedFeed`) and updates are verified before extraction with the EdDSA public key built into the App; without a valid key and an https feed, Settings shows updates as not configured.
- Default: check every 6 hours (`SUScheduledCheckInterval` 21600), ask before installing, no system profiling. Settings offers manual checks, notify-only, or automatic download and install. Background checks only show in the menu and Settings, without interrupting other apps.
- Before Sparkle relaunches, Untangle stops its modules so the event tap, system hot keys and menu bar spacers are restored.

## Custom leader key

Settings → Shortcuts shows the Leader Key as one row, using the same Record/Save
control as command shortcuts. It defaults to right Command; the reset arrow or
Delete during recording restores that default. Record a single regular key, an
F1–F20 key, a left/right Ctrl, Option, Shift or Command key, or a modifier-plus-key
chord such as Control–Option–K. Press and release a modifier on its own, then click
Save. The preview identifies its side, for example “Right Ctrl”. Esc cancels a draft.

Newly recorded modifiers use hold mode; existing saved tap settings remain intact
until the entry key is changed or reset. Right Ctrl and left Ctrl are distinct.
Holding strips only the entry modifier from captured command keys, and releasing
it ends the hold even if the opposite-side Ctrl remains down. Other modifiers,
ordinary Ctrl shortcuts in tap mode, recording cancellation and secure-input
suppression retain their existing behavior. Existing right-Command and chord
settings migrate without changing their trigger.

Recording a plain key takes over that key globally; the settings page warns before
it is used. Known Untangle shortcut conflicts are rejected at Save. Other apps and
macOS may reserve keys before the recorder receives them; media keys may need Fn
to produce an F-key event. Caps Lock/Fn alone, simultaneous ordinary letter keys,
modifier-only combinations and sequential multi-key entry triggers are not supported.
The recorder uses local AppKit events and the existing global input service; it adds
no permissions or system shortcut modifications.

## Region collision (Beta)

The default-off option sits in Layout → Placement. It deliberately departs from the rule that a layout operation moves only the window it acts on, which is why it is opt-in.

**Resizing.** When you drag an edge or corner of a window, the windows touching that edge keep to it both ways: grow the window and they shrink out of its way, shrink it and they grow back. Touching means the facing edges are twice the window gap apart, within 4 points, and share some length; meeting at a corner does not count. Windows on the resized window's side whose edge lies on the same line, next to one of those, move with the line, including a window stacked under the resized one at the same place. A window further out that the edge runs into gives way only as far as the edge reaches and returns, at most to where it was, if you drag back. Every follower keeps at least 120 points across, or its own size when that was smaller; a window with a larger minimum size keeps the size it insists on. A resize counts only when, against the window's frame at the press, one edge on each axis stays where it was and the press is within 16 points of an edge that moved: a title-bar drag, an app resizing its own window, or an Option-drag that resizes around the middle does not collide, and a resize that turns into a move sends its followers back. Followers move without animation while you drag and are aligned once more when you let go; each follower's previous frame is then one step of **Z**, and so is the resized window's own, when it moved a follower: going back on either window takes the whole boundary back.

**Placing.** Halves, corners and edge snaps fill the region the other windows mark out. For the left half, the boundary is the right edge of a window against the left side of the screen, otherwise the left edge of one against the right side, a gap away, otherwise the middle. Corners settle left and right first, then top and bottom within that column. Repeating a half within the leader's linger second moves the boundary to 1/3, 2/3 and 1/2 of the screen, and the windows along it follow. Maximize, center, the Option grid, other displays and desktops and workspace restores never collide. **Going back** (leader, then Z) collides when it resizes the window, one edge on each axis staying: the windows along the edges that move go back with it, and the frames they remembered for that move are taken out, so the whole boundary returns. Going back that moves the window whole, or that takes a tab group's merge apart, moves nothing else.

Only windows on the same display and on the desktop showing count; minimized, full-screen and hidden-app windows do not. A tab group counts as one window by its area, bar included, and moves through its front tab; its other tabs follow through the tab group module, which does not merge windows because of such a move. A window is read when the mouse button goes down: a resize faster than that read may start a few points off. Windows that size themselves in steps, such as Terminal, may stop short of an edge by more than 4 points and then do not count as touching.

## Mission Control desktop previews (Beta)

Research on 2026-10-19 found no Apple-documented command, defaults key or dedicated supported API for persistent Spaces-bar expansion. Apple's [Spaces guide](https://support.apple.com/guide/mac-help/work-in-multiple-spaces-mh14112/mac) describes hovering at the top; the [Desktop & Dock reference](https://support.apple.com/guide/mac-help/change-desktop-dock-settings-mchlp1119/mac) documents no persistent expansion option. This feature writes no system preferences.

The default-off option is at the bottom of Layout beside desktop-shortcut takeover, independently of that option. When enabled, **Control–Up and upward trackpad entry** prepare an internal empty AppKit drag so the Dock initially shows desktop-content thumbnails. The trackpad path briefly buffers and copies the original native events, then replays that prefix and passes live input through: the animation follows the fingers, with no opening command on release. Downward exit, horizontal swipes, F3, Hot Corners and other launchers retain native behavior; no polling or assistance is applied after another launcher has opened Mission Control. F3 enhancement was explicitly excluded by the user.

`MissionControlDragSession` uses a transparent, nonactivating, mouse-pass-through panel, an empty application-specific pasteboard item and no allowed drop operations. Its mouse-down goes directly to its own view and its mouse-up is queued only inside this App. No global mouse event, cursor repositioning or general clipboard change is used. The approach was independently implemented after studying Brian Kendall's [missionControlFullDesktopBar](https://github.com/briankendall/missionControlFullDesktopBar/tree/84994bc373b0df9ae188c0967be451b4a18b6777) (Unlicense). No Dock injection or SIP change is involved.

`MissionControlPreviews` waits for the actual drag callback plus a measured 100 ms settling margin; a missing callback gets a bounded 150 ms grace period. Native gesture completion retains the drag for 400 ms. A quick retry reuses a live drag and cancels the previous cleanup timer; if cleanup has begun, it waits for its own queued release before preparing again. The native prefix fails open after 300 ms or 128 events, is tagged against re-interception, and is flushed on tap reset/stop. All waits and Dock reads stay off the input thread. Shared desktop-operation exclusion, physical mouse-button checks, permission checks and stale-preparation identity checks remain in place.

The keyboard path uses the existing dynamically resolved `CoreDockSendNotification` wrapper, falling back to `/System/Applications/Mission Control.app` only if the symbol is absent. An already-open or unknown Dock state uses the ordinary keyboard toggle; gesture preparation leaves that state alone. Disabling/stopping the feature releases its shortcut and gesture ownership and cancels its drag. A conflicting shortcut owner is preserved; the gesture can still operate independently.

Accessibility permission is required; this option adds no Screen Recording or Input Monitoring prompt. The AppKit calls are public, but Dock's drag-expansion behavior, its AX identifiers, private gesture fields and Dock notification are undocumented. Gesture support is limited to macOS major version 26. Compatibility is measured on macOS 26.6.1 (25G76), two displays; fullscreen, Split View and future system versions remain unverified. Failed preparation falls back to native input and may leave the bar folded for that entry.

Validation on 2026-10-19: deterministic tests cover preparation/cleanup, cancellation and immediate retry, missing end events, held buttons, permission changes, buffer order/tokens/deadlines, settings migration and shortcut ownership. The native AppKit retry probe reused a drag three times, observed 146 pt bars on both displays, verified unchanged pointer/buttons, and finished/closed normally. The user explicitly confirmed that top thumbnails follow the swipe, interrupted entry can be retried, the mouse does not jump and downward exit works. The final installed keyboard observation was invalidated by physical input and is not counted as a pass; prior installed keyboard tests passed. Full test counts and installation receipts are retained in `build/mission-control-previews/`.

Opt-in native checks (ordinary tests never open Mission Control): `zsh Tests/MissionControlPreviews/run.sh` tests the keyboard component; `--retry` tests actual drag reuse; `--installed` exercises the installed shortcut; `--installed-follow` observes real physical gestures. Synthetic minimal Dock events do not establish hardware finger-following. Historical prototypes, rejected approaches, logs and old-App backups remain local under `build/mission-control-previews/`; the complete pre-review narrative is retained in the branch archive.
