// commands/sws/sub_commands/utility/config_format.js
/**
 * server_config.xml の期待されるフォーマット定義
 * 将来的なゲームアップデートで変更があった場合に、このファイルを更新することで対応しやすくします。
 */
const path = require('path');

// デフォルトミッションとして許可するパスのリスト
const defaultPlaylistPaths = Object.freeze([
    "rom/data/missions/default_ai",
    "rom/data/missions/default_aircraft",
    "rom/data/missions/default_cargo",
    "rom/data/missions/default_creatures",
    "rom/data/missions/default_dock_bollards",
    "rom/data/missions/default_elevators",
    "rom/data/missions/default_fish_survey",
    "rom/data/missions/default_forest_fire_missions",
    "rom/data/missions/default_landmarks",
    "rom/data/missions/default_mission_locations",
    "rom/data/missions/default_mission_transport_locations",
    "rom/data/missions/default_mission_zones_arctic",
    "rom/data/missions/default_mission_zones_arid",
    "rom/data/missions/default_mission_zones_building",
    "rom/data/missions/default_mission_zones_delivery",
    "rom/data/missions/default_mission_zones_main",
    "rom/data/missions/default_mission_zones_moon",
    "rom/data/missions/default_mission_zones_sawyer",
    "rom/data/missions/default_mission_zones_underwater",
    "rom/data/missions/default_natural_disasters",
    "rom/data/missions/default_oil_survey",
    "rom/data/missions/default_paths",
    "rom/data/missions/default_railroad_signals",
    "rom/data/missions/default_resource_storage",
    "rom/data/missions/default_rescue_trading",
    "rom/data/missions/default_tutorial",
    "rom/data/missions/dlc_weapons_ai",
    "rom/data/missions/dlc_zombies",
]);

// ★★★ デフォルトの base_island として許可するパスのリスト ★★★
// (実際の rom/data/tiles/ 内のファイル名に合わせてください)
const defaultBaseIslandPaths = Object.freeze([
  // === Main Biome ===
  "data/tiles/island_15.xml",                      // Creative Island (リストから)
  "data/tiles/island_43_multiplayer_base.xml",     // Multiplayer Base (リストから)
  "data/tiles/island_34_military.xml",             // Military Base (リストから)
  "data/tiles/island_25.xml",                      // Harbour Base (リストから)
  "data/tiles/island12.xml",                       // Starter Base (リストから) ※ファイル名注意: island_12.xml とは別?
  "data/tiles/test_tile.xml",                      // Helicopter Base (リストから)
  "data/tiles/island_24.xml",                      // Airstrip Base (リストから)
  "data/tiles/island_33_tile_33.xml",              // Mainland Airstrip (リストから)
  "data/tiles/island_33_tile_32.xml",              // Terminal Spycakes (リストから)
  "data/tiles/island_33_tile_end.xml",             // Terminal Camodo (リストから)

  // === Custom Bases ===
  "data/tiles/island_29_playerbase_submarine.xml", // Custom Base Submarine (リストから)
  "data/tiles/island_32_playerbase_heli.xml",      // Custom Base Heli (リストから)
  "data/tiles/island_30_playerbase_boat.xml",      // Custom Base Large Boat (リストから)
  "data/tiles/island_31_playerbase_combo.xml",     // Custom Base Small Boat (リストから)
  "data/tiles/oil_rig_playerbase.xml",             // Custom Base Oil Rig (リストから)

  // === Arctic Islands ===
  "data/tiles/arctic_island_playerbase.xml",       // Arctic Island Base (リストから)
  "data/tiles/arctic_tile_22.xml",                 // Arctic Mainland Outpost (リストから)
  "data/tiles/arctic_tile_12_oilrig.xml",          // Arctic Oil Platform (リストから)

  // === Sawyer Islands ===
  "data/tiles/mega_island_2_6.xml",                // Harrison Airbase (リストから)
  "data/tiles/mega_island_12_6.xml",               // O'Neill Airbase (リストから)
  "data/tiles/mega_island_9_8.xml",                // North Harbor Dock (リストから & 以前のリスト)
  "data/tiles/mega_island_15_2.xml",               // Fishing Village Dock (リストから)

  // === Arid Islands/Meier Islands ===
  "data/tiles/arid_island_5_14.xml",               // North Meier Outpost (リストから)
  "data/tiles/arid_island_6_7.xml",                // Serpentine Trainyard (リストから)
  "data/tiles/arid_island_7_5.xml",                // Ender AirField (リストから)
  "data/tiles/arid_island_8_15.xml",               // Uran Wind Power Plant Docks (リストから)
  "data/tiles/arid_island_11_14.xml",              // Brainz Train Yard (リストから)
  "data/tiles/arid_island_12_10.xml",              // Mauve Train Yard (リストから)
  "data/tiles/arid_island_19_11.xml",              // Clarke Airfield (リストから)
  "data/tiles/arid_island_24_3.xml",               // JSI Dock (リストから)
  "data/tiles/arid_island_26_14.xml",              // FJ Warner Docks (リストから)

  // === 以前のリストに含まれていた他のタイル (必要に応じて維持・確認) ===
  "data/tiles/island_01.xml",
  "data/tiles/island_02_helipad.xml",
  "data/tiles/island_03_runway.xml",
  "data/tiles/island_04_barge.xml",
  "data/tiles/island_05_lighthouse.xml",
  "data/tiles/island_06_fishing_village.xml",
  "data/tiles/island_07_shipwreck.xml",
  "data/tiles/island_08_container_port.xml",
  "data/tiles/island_10_nuclear_plant.xml",
  "data/tiles/island_11_research_outpost.xml",
  "data/tiles/island_12_arctic_base.xml", // arctic_island_playerbase.xml との関係を確認
  "data/tiles/island_13_wind_farm.xml",
  "data/tiles/island_14_radio_tower.xml",
  "data/tiles/island_15_sawyer_south_harbor.xml", // mega_island_9_8.xml との関係を確認
  "data/tiles/island_16_airport.xml", // island_24.xml, mainland_airstrip などとの関係を確認
  "data/tiles/island_17_military_base.xml", // island_34_military.xml との関係を確認
  "data/tiles/island_18_train_depot.xml", // 各 Train Yard との関係を確認
  "data/tiles/island_19_sawyer_north_base.xml", // mega_island_12_6.xml? との関係を確認
  "data/tiles/island_20_hospital.xml",
  "data/tiles/island_21_coast_guard_base.xml",
  "data/tiles/island_22_police_station.xml",
  "data/tiles/island_23_fire_station.xml",
  "data/tiles/island_24_sawyer_island_village.xml", // mega_island_15_2.xml との関係を確認
  "data/tiles/island_25_sawyer_nuclear_power_plant.xml", // Uran Wind Power Plant との関係を確認
  "data/tiles/multiplayer_island.xml", // island_43_multiplayer_base.xml との関係を確認
  "data/tiles/creative_island.xml",   // island_15.xml との関係を確認
  "data/tiles/oilrig_a.xml", // oil_rig_playerbase.xml, arctic_tile_12_oilrig.xml との関係を確認
  "data/tiles/oilrig_b.xml", 
]);


module.exports = Object.freeze({
    // <server_data> 要素の定義
    serverData: {
        // 許可される属性とその定義
        attributes: {
            port: { type: 'integer', required: true, range: [1024, 65535], autoAssign: true },
            name: { type: 'string', required: true, allowEmpty: false },
            seed: { type: 'integer', required: true },
            save_name: { type: 'string', required: true, allowEmpty: false },
            max_players: { type: 'integer', required: true, range: [1, 32] },
            password: { type: 'string', required: false, allowEmpty: true },
            day_length: { type: 'integer', required: false },
            night_length: { type: 'integer', required: false },
            infinite_resources: { type: 'boolean', required: false },
            unlock_all_islands: { type: 'boolean', required: false },
            settings_menu: { type: 'boolean', required: false },
            // ★★★ base_island の type を変更 ★★★
            base_island: { type: 'filepath_baseisland', required: false }, // 存在確認は checkPathExists で
            settings_menu_lock: { type: 'boolean', required: false },
            infinite_batteries: { type: 'boolean', required: false },
            infinite_fuel: { type: 'boolean', required: false },
            engine_overheating: { type: 'boolean', required: false },
            ceasefire: { type: 'boolean', required: false },
            infinite_ammo: { type: 'boolean', required: false },
            no_clip: { type: 'boolean', required: false },
            map_teleport: { type: 'boolean', required: false },
            vehicle_spawn: { type: 'boolean', required: false },
            photo_mode: { type: 'boolean', required: false },
            respawning: { type: 'boolean', required: false },
            cleanup_vehicle: { type: 'boolean', required: false },
            clear_fow: { type: 'boolean', required: false },
            third_person: { type: 'boolean', required: false },
            third_person_vehicle: { type: 'boolean', required: false },
            vehicle_damage: { type: 'boolean', required: false },
            player_damage: { type: 'boolean', required: false },
            npc_damage: { type: 'boolean', required: false },
            aggressive_animals: { type: 'boolean', required: false },
            sea_monsters: { type: 'boolean', required: false },
            lightning: { type: 'boolean', required: false },
            teleport_vehicle: { type: 'boolean', required: false },
            fast_travel: { type: 'boolean', required: false },
            starting_currency: { type: 'integer', required: false },
            despawn_on_leave: { type: 'boolean', required: false },
            map_show_players: { type: 'boolean', required: false },
            map_show_vehicles: { type: 'boolean', required: false },
            show_3d_waypoints: { type: 'boolean', required: false },
            show_name_plates: { type: 'boolean', required: false },
            override_weather: { type: 'boolean', required: false },
            override_time: { type: 'boolean', required: false },
            override_wind: { type: 'boolean', required: false },
            physics_timestep: { type: 'integer', required: false },
            wildlife_enabled: { type: 'boolean', required: false },
            unlock_components: { type: 'boolean', required: false },
            dlc_weapons: { type: 'boolean', required: false },
            dlc_arid: { type: 'boolean', required: false },
            dlc_space: { type: 'boolean', required: false },
            // --- 新しい属性があれば追記 ---
        },
        requiredChildren: ['admins', 'authorized', 'blacklist', 'whitelist', 'playlists', 'mods'],
        allowedChildren: ['admins', 'authorized', 'blacklist', 'whitelist', 'playlists', 'mods'],
    },

    // <id value="..."> を持つ要素
    idListElements: {
        admins: { childTag: 'id', valueAttribute: 'value', type: 'steamid64' },
        authorized: { childTag: 'id', valueAttribute: 'value', type: 'steamid64' },
        blacklist: { childTag: 'id', valueAttribute: 'value', type: 'steamid64' },
        whitelist: { childTag: 'id', valueAttribute: 'value', type: 'steamid64' },
    },

    // <path path="..."> を持つ要素
    pathListElements: {
        playlists: { childTag: 'path', pathAttribute: 'path', type: 'filepath_playlist' },
    },

    // <mods> 要素
    modsElement: {
        allowedChildren: ['path', 'published_id'],
        path: {
            pathAttribute: 'path',
            type: 'filepath_mod',
        },
        published_id: {
            valueAttribute: 'value',
            type: 'workshopid',
        }
    },

    // 型定義とチェック関数
    types: {
        string: (value) => typeof value === 'string',
        integer: (value) => /^-?\d+$/.test(value),
        boolean: (value) => value === 'true' || value === 'false',
        steamid64: (value) => /^\d{17}$/.test(value),
        // ★ ワークショップID: 10桁または11桁の数字
        workshopid: (value) => /^\d{10,11}$/.test(value),
        // ファイルパスの基本形式チェック (空でない文字列) - これは base_island の型チェックには直接使わない
        // filepath: (value) => typeof value === 'string' && value.length > 0,
        // ★★★ プレイリストパス: デフォルトリストに含まれるか、または "rom/data/workshop_missions/数字ID" 形式か ★★★
        filepath_playlist: (value) => {
            if (typeof value !== 'string' || value.length === 0) return false;
            // 1. デフォルトミッションリストに含まれるかチェック
            if (defaultPlaylistPaths.includes(value)) {
                return true;
            }
            // 2. ワークショッププレイリスト形式かチェック ("rom/data/workshop_missions/数字ID" の形式、末尾のサブディレクトリは不可)
            const workshopPlaylistRegex = /^rom\/data\/workshop_missions\/\d{10,11}$/;
            return workshopPlaylistRegex.test(value);
        },
        // Modパス形式チェック (存在確認は checkPathExists で)
        filepath_mod: (value) => {
            if (typeof value !== 'string' || value.length === 0) return false;
            // Windows/Linuxの絶対パス or 相対パス (単純チェック)
            // ワークショップModを <path> で指定する場合は絶対パスになることが多い
            return path.isAbsolute(value) || value.includes('/') || value.includes('\\');
        },
        // ★★★ Base Island パス: デフォルトリストに含まれるかチェック ★★★
        filepath_baseisland: (value) => {
            if (typeof value !== 'string' || value.length === 0) return false;
            return defaultBaseIslandPaths.includes(value);
        }
    },

    // デフォルトリストをエクスポート (check_config.js で使うため)
    defaultPlaylistPaths,
    defaultBaseIslandPaths, // ★★★ Base Island のリストもエクスポート ★★★
});