# Trigger Bloxxy

A blocky browser-based multiplayer FPS built with Three.js, Node.js, and Socket.io. It supports lobbies, free-for-all Battle rounds, Co-Op zombie waves, voting, map selection, detailed guns, grenades, settings, and Render deployment.

## Running Locally

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Render Deployment

The client uses same-origin Socket.io via `io()` and same-origin assets such as `/three/...`, so it works on Render without hardcoded localhost URLs.

Render start command:

```bash
npm start
```

## Changelog

### v0.1 - First Playable Prototype
- Added Node.js/Socket.io server.
- Added single-file Three.js client.
- Added PointerLockControls FPS movement.
- Added basic arena, crosshair, online counter, and remote player boxes.

### v0.2 - Weapons and Combat
- Added assault rifle, shotgun, sniper, raycast shooting, recoil, muzzle flash, and scoped aiming.
- Added hit detection, player health, scoring, and respawns.

### v0.3 - Multiplayer Polish
- Added humanoid remote player rigs.
- Added synced shooting events and smoother player state updates.
- Added username login and kill feed.

### v0.4 - Movement and Map Feel
- Improved movement, sprinting, jumping, sliding, gravity, and camera bob.
- Tightened collision handling.
- Added bridge ramps, water, mountains, cover, pickups, lights, barrels, and crates.

### v0.5 - Rounds and Co-Op
- Added voting between Battle and Co-Op.
- Added Co-Op zombie waves.
- Added zombie damage, zombie kills, and wave progression.
- Added grenade throwing and explosion damage.

### v0.6 - Settings and HUD
- Added settings panel with sensitivity, keybinds, performance toggle, and low-detail mode.
- Added FPS, ping, and render timing.
- Added healthbar and ammo UI.
- Added reloadable ammo for guns.

### v0.7 - Render Compatibility
- Removed localhost assumptions.
- Served Three.js modules from local dependencies.
- Made server listen on `process.env.PORT` and `0.0.0.0`.
- Pushed deployment-ready commits for Render.

### v0.8 - Map Selection and Co-Op Polish
- Added synced map selection.
- Added Hydro Dream and Afterhours Mall maps.
- Capped Co-Op at 6 waves.
- Reduced zombie wave size and speed.
- Fixed zombie facing so they run toward players.

### v0.9 - Liminal Aesthetic Pass
- Improved map selection text wrapping.
- Added accessible scrollbars and scrollable overlays.
- Made Afterhours Mall read more like a mall with ceiling, shops, glass, signs, skylights, and tiled concourse.
- Made Hydro Dream read more like a hydro facility with buildings, tanks, pipes, canopy, bridge, and water.
- Rebuilt the knife into a coherent held weapon pose.
- Increased shotgun pellet spread.
- Added procedural texture noise/grid materials for maps and weapons.

### v1.0 - Warehouse and Mall Expansion
- Rebuilt Hydro Dream as an indoor warehouse with catwalks, conveyors, shelves, water channels, and industrial cover.
- Expanded Afterhours Mall into a three-floor ruined atrium with shops, balconies, ramps, railings, and rubble.
- Added an intro screen before login.
- Added remappable shoot and aim keybinds.
- Added floating damage numbers and a death screen effect.
- Reworked the first-person knife into a cleaner held blade model.

### v1.1 - Synchronized Arena and Voting Pass
- Made map generation deterministic per map so every client sees the same cover, catwalks, rubble, and warehouse props.
- Moved mode and map voting into a dedicated voting screen.
- Removed knife from gameplay and the weapon UI.
- Removed bullet trails while keeping muzzle flash and hit markers.
- Added username labels above remote players.
- Added stronger red damage feedback, reload motion, and shooting kick animations.
- Reset gun ammo on round changes so players are not stuck empty forever.

### v1.2 - Trigger Bloxxy Lobby Pass
- Renamed the game to Trigger Bloxxy.
- Added a blocky title menu with lobby selection and an animated blocky gun intro.
- Added a blocky gun favicon.
- Expanded Hydro Dream into a larger warehouse with more loading bays, crane rails, office space, forklifts, pumps, and cover.
- Added animated water surfaces with foam strips.
- Prevented ground snapping from teleporting players onto catwalks and bridges from below.
- Made player rigs more blocky while keeping guns detailed.

### v1.3 - Forest, Galley, Shop, and Lobby Flow
- Replaced the old maps with deterministic Trigger Forest and Trigger Ship layouts so every client sees the same cover.
- Made Trigger Forest denser with block trees, rocks, cabins, watchtowers, and a mine entrance.
- Rebuilt Trigger Ship as an ancient blocky galley over deep animated water.
- Added username-based local profile saves with credits and owned weapons.
- Players now start with only the assault rifle; locked or lobby-restricted weapons cannot be equipped.
- Added a menu weapon shop with gun previews, SMG, DMR, and Grenade Launcher unlocks.
- Added credit rewards for player kills and zombie kills.
- Added a menu-first lobby flow with create/find lobby, host-selected map, gun restrictions, start, and kick support.

### v1.4 - Customization, Skins, and Trigger Citadel
- Added saved character customization with color and body style options.
- Added purchasable weapon skins that use credits and persist per account.
- Added an inventory panel for owned guns and equipped skins.
- Added Trigger Citadel, a deterministic floating block ruin map.
- Synced customized player colors and styles to other clients.

### v1.5 - Dungeon, Chat, Friends, and Lobby Polish
- Replaced Trigger Citadel with Trigger Dungeon, a deterministic underground maze with torches, pickups, and spinning crystals.
- Made Trigger Forest cabins enterable and added ambient tree/particle motion.
- Improved Trigger Ship spawning, deck collision, side rails, and animated sea foam.
- Added censored in-lobby chat.
- Improved friend requests with lobby buttons, duplicate prevention, and synced friend status.
- Added an all-played accounts browser on the login screen.
- Changed weapon skins to alter weapon attachments, rails, glass, materials, and design accents instead of simply recoloring the whole gun.
- Smoothed Mega Portal and lobby host behavior for multiplayer sessions.
