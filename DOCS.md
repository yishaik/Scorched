# Scorched Tanks: Developer Documentation

## What it is
Scorched Tanks is a faithful recreation of Scorched Earth (1991, DOS, by Wendell Hicken), built for Android phones with touch controls. It was built 2026-10-13 and 2026-10-14. The game UI is in English, as in the original.

## Layout
| Path | What |
|---|---|
| `game/index.html` | The entire game in one file: HTML5 Canvas, WebAudio and vanilla JS, with no build step. |
| `game/hark.css`, `hark-hero.css`, `hark.js` | Page-shell styles and scripts the HTML references. The game itself does not depend on them. |
| `android/` | Minimal Android WebView wrapper. Source is `MainActivity.java`, `AndroidManifest.xml` and the vector icon. It also has Gradle files in case you want to build it in Android Studio. |
| `apk/ScorchedTanks.apk` | Latest signed build: v1.4, versionCode 4, package `com.yishai.scorchedtanks`. |
| `build.sh` | Builds the APK without Gradle. |
| `key.jks` | Signing keystore. Included in the private backup only, never in a public repo. |

## Playing / testing
- **Browser:** open `game/index.html` directly. It works in portrait and landscape, with mouse or touch.
- **Android:** install the APK and allow installs from unknown sources.
  - It runs fullscreen and keeps the screen on.
  - It rotates with the phone (orientation `fullUser`).
  - The game loads from `file:///android_asset/index.html`.

## Game features
- **Players:** 2–10 tanks.
  - Each is a human or one of 7 CPU types: Moron, Shooter, Poolshark, Tosser, Chooser, Spoiler, Cyborg.
- **Rounds and money:** rounds, cash and kills, a standings table, and a shop between rounds.
  - The shop has Buy and Sell, and inventory carries over between rounds.
  - CPU players buy too, in the original pack sizes.
  - Since v1.14 every price is a tenth of the original and sold one unit at a time; press and hold BUY/SELL to repeat.
- **Weapons:**
  - Missiles: Baby Missile, Missile, Baby Nuke, Nuke.
  - Clusters: Leapfrog, Funky Bomb, MIRV, Death's Head.
  - Fire: Napalm, Hot Napalm.
  - Tracers: Tracer, Smoke Tracer.
  - Rollers: Baby, regular, Heavy.
  - Riot weapons: Riot Charge, Riot Blast, Riot Bombs.
  - Diggers: Baby, regular, Heavy.
  - Sandhogs: Baby, regular, Heavy.
  - Dirt: Dirt Clod, Dirt Ball, Ton of Dirt, Liquid Dirt, Dirt Charge.
  - Specials: Earth Disrupter, Plasma Blast, Laser.
- **Items:**
  - Defence: Parachute, Battery, Shield, Force Shield, Heavy Shield, Mag Deflector, Super Mag.
  - Movement: Fuel Tank, which lets the tank drive left and right.
  - Firing aids: Contact Trigger, plus Heat, Ballistic, Horizontal and Vertical Guidance.
- **Terrain:** destructible pixel bitmap, with tunnels, falling dirt and falling tanks.
- **Options:**
  - Wind: None, Normal, Strong, Changing.
  - Walls: Open, Wrap, Padded, Concrete, Random.
  - Terrain: Random, Rolling, Mountains, Jagged, Flat, Cavern.
  - Gravity: Low, Normal, High.
  - Sky: Gradient, Black, Stars, Random.
- **Maps (v1.14+):** a Map button in setup and in the online lobby opens a picker (Generated, saved maps, edit, delete, draw new).
  - The builder: draw the ground with a finger; TREE/BUSH/WRECK tools place decor (tap again to remove); CLEAR, SMOOTH, SAVE.
  - Stored in localStorage `st-maps` as `{n, h: 160 heights 0-100, d: [[column, type]]}`; the chosen map rides in `cfg.map`, so online guests get it.
- **Graphics (v1.14+):** Modern (default) or Classic, in setup and in the in-game Settings; stored in `st-gfx`.
  - Modern: a painted sky per sky option, three parallax ridges with trees and wreck silhouettes, a grass edge, textured dirt and rocks, detailed tanks, smoke from dead tanks.
  - Decor (trees, bushes, wrecks) is visual only: random decor is derived from a hash of the terrain, so it never touches the game RNG; a blast burns what it reaches.
  - Button labels shrink to fit their buttons (`fitButtons`).
- **Presentation:** title screen with fireworks, and taunts when firing or dying.
  - WebAudio sound effects.
  - Pause, mute and quit.

## Controls
- **Drag aiming:** drag anywhere on the battlefield on your turn.
  - The direction from the tank to your finger sets the angle, 0–180°.
  - The distance sets the power: about 45% of the canvas width is full power, which is 100.
  - Releasing does not fire.
- **Buttons:** Angle −/+, Power −/+, Weapon, Items, Move (shown only with fuel) and FIRE. Holding a button repeats it.
- **Layout:**
  - Portrait: a compact HUD, then the canvas filling the middle, then 2 thin rows of controls (about 97px).
  - Landscape: HUD, then canvas, then a single 48px row.
  - Nothing overlaps the canvas except popups.
- Health is shown as a coloured number above each tank.

## Building the APK (`build.sh`)
The sandbox it was built in is ARM64 Linux, so it skips Gradle and aapt2 and uses Debian packages instead.
1. `sudo apt-get install openjdk-21-jdk-headless aapt zipalign`
2. Download and unzip into `$A` (default `/workspace/work/apk`):
   - `https://dl.google.com/android/repository/platform-34-ext7_r03.zip` into `$A/p`, for `android-34/android.jar`
   - `https://dl.google.com/android/repository/build-tools_r34-linux.zip` into `$A/b`, for the `lib/d8.jar` and `lib/apksigner.jar` jars
3. Put `key.jks` at `$A/key.jks` (alias `st`). The key and its password are kept privately and are not in this repo; pass the password as `KS_PASS` (used for both store and key).
   - Always reuse the same key, or the update won't install over the existing app.
4. Run `KS_PASS=<keystore password> VC=<next versionCode> ./build.sh`. Output: `$A/out/ScorchedTanks.apk`.

The pipeline:
1. aapt v1 generates R.java.
2. javac compiles it (`--release 11`).
3. d8 produces the dex.
4. aapt packages the res and assets.
5. The dex is added, then zipaligned and signed with apksigner (v1+v2).

targetSdk is 28, which avoids the uncompressed resources.arsc requirement.

On a normal x86 machine you can instead open `android/` in Android Studio. Copy `game/*` into `android/app/src/main/assets/` first.

## Known gaps / ideas
- Not yet play-tested thoroughly on a real phone.
- Walls don't affect Rollers or Diggers.
- The Cavern ceiling doesn't fall.
- The original game's rule that max power drops with damage isn't implemented. The cap is one constant, used by both the drag and Power +.
