const chalk = require('chalk') // chalkのインポート形式を修正

// デバッグモードの設定
const DEBUG_MODE = true // true: 詳細なデバッグログを表示, false: 基本的なログのみ

if (DEBUG_MODE) {
    console.log(chalk.blue('[DEBUG] Loading presets...'))
} else {
    console.log('[INFO] Loading presets...')
}

// commands/utility/sws/utils/presets.js

const defaultWorldSettings = {
    port: 12345,                     // XMLの値: 12345
    name: "testserver1",             // XMLの値: "testserver1"
    seed: 16327,                     // XMLの値: 16327
    save_name: "autosave_server",    // XMLの値: "autosave_server"
    max_players: 32,                 // XMLの値: 32
    password: "",                    // XMLの値: ""
    day_length: 30,                  // XMLの値: 30
    night_length: 30,                // XMLの値: 30
    infinite_resources: false,       // XMLの値: "false"
    unlock_all_islands: false,       // XMLの値: "false"
    settings_menu: false,            // XMLの値: "false"
    base_island: "data/tiles/island12.xml", // XMLの値: "data/tiles/island12.xml"
    settings_menu_lock: false,       // XMLの値: "false"
    infinite_batteries: false,       // XMLの値: "false"
    infinite_fuel: false,            // XMLの値: "false"
    engine_overheating: false,       // XMLの値: "false"
    ceasefire: false,                // XMLの値: "false"
    infinite_ammo: false,            // XMLの値: "false"
    no_clip: false,                  // XMLの値: "false"
    map_teleport: false,             // XMLの値: "false"
    vehicle_spawn: false,            // XMLの値: "false"
    photo_mode: false,               // XMLの値: "false"
    respawning: false,               // XMLの値: "false"
    cleanup_vehicle: false,          // XMLの値: "false"
    clear_fow: false,                // XMLの値: "false"
    third_person: true,              // XMLの値: "true"
    third_person_vehicle: true,      // XMLの値: "true"
    vehicle_damage: false,           // XMLの値: "false"
    player_damage: false,            // XMLの値: "false"
    npc_damage: false,               // XMLの値: "false"
    aggressive_animals: false,       // XMLの値: "false"
    sea_monsters: false,             // XMLの値: "false"
    lightning: true,                 // XMLの値: "true"
    teleport_vehicle: true,          // XMLの値: "true"
    fast_travel: true,               // XMLの値: "true"
    starting_currency: 20000,        // XMLの値: 20000
    despawn_on_leave: false,         // XMLの値: "false"
    map_show_players: false,         // XMLの値: "false"
    map_show_vehicles: false,        // XMLの値: "false"
    show_3d_waypoints: false,        // XMLの値: "false"
    show_name_plates: false,         // XMLの値: "false"
    override_weather: false,         // XMLの値: "false"
    override_time: false,            // XMLの値: "false"
    override_wind: false,            // XMLの値: "false"
    physics_timestep: 0,             // XMLの値: 0
    wildlife_enabled: true,          // XMLの値: "true"
    unlock_components: true,         // XMLの値: "true"
    dlc_weapons: false,              // XMLの値: "false"
    dlc_arid: false,                 // XMLの値: "false"
    dlc_space: false                 // XMLの値: "false"
}

module.exports = {
    /**
     * アドオン（Playlists）プリセットの定義
     */
    addonPresets: [
        {
            name: "メインアドオン", // ドロップダウン表示名
            description: "AddonTools,MeterWidget,SlowmoScripts,ObjectCleaner", // ドロップダウン説明
            value: "main_addons", // 内部識別子 (重複不可)
            items: [
                { type: 'playlist', value: "workshop/2317348717" },
                { type: 'playlist', value: "workshop/2981734922" },
                { type: 'playlist', value: "workshop/2417541020" },
            ]
        },
        {
            name: "AutoAuth",
            description: "Auto Auth mk1",
            value: "auto_auth",
            items: [
                { type: 'playlist', value: "workshop/2787688338" },
            ]
        },
        {
            name: "高速ガソスタ",
            description: "",
            value: "highway_gas_station",
            items: [
                { type: 'playlist', value: "workshop/3011218359" },
            ]
        },
        {
            name: "サーキットタイム計測",
            description: "アドオンをロードしません。",
            value: "circuit_time_board",
            items: [
                { type: 'playlist', value: "workshop/3011218359" },
            ]
        },
    ],

    /**
     * Modプリセットの定義
     */
    modPresets: [
        {
            name: "高速道路",
            description: "ライティングなし",
            value: "highway",
            items: [
                { type: 'mod', value: "workshop/3369477254" },
            ]
        },
        {
            name: "ESTT",
            description: "EastSawyerTestTrack",
            value: "estt",
            items: [
                { type: 'mod', value: "workshop/3369477713" },
            ]
        },
        {
            name: "GSRW",
            description: "GroundStoneRaceWay",
            value: "touge",
            items: [
                { type: 'mod', value: "workshop/3360543435" },
            ]
        },
        {
            name: "OTRC",
            description: "OlsenTwinRingCircuit",
            value: "otrc",
            items: [
                { type: 'mod', value: "workshop/3378462875" },
            ]
        },
        {
            name: "BuildAndRacing (Server)",
            description: "これはStormLoaderが必要ない",
            value: "build_and_racing",
            items: [
                { type: 'mod', value: "workshop/3369478459" },
            ]
        },
    ],

    worldSettingsPresets: [
        {
            name: "Default World",
            description: "デフォルトのワールド設定",
            value: "default_world",
            settings: { ...defaultWorldSettings }
        },
        {
            name: "Creative Mode",
            description: "クリエイティブモード用の設定",
            value: "creative_mode",
            settings: {
                ...defaultWorldSettings,
                infinite_resources: true,
                infinite_batteries: true,
                infinite_fuel: true,
                vehicle_damage: false,
                player_damage: false,
                npc_damage: false
            }
        },
        {
            name: "Survival Mode",
            description: "サバイバルモード用の設定",
            value: "survival_mode",
            settings: {
                ...defaultWorldSettings,
                infinite_resources: false,
                infinite_batteries: false,
                infinite_fuel: false,
                vehicle_damage: true,
                player_damage: true,
                npc_damage: true
            }
        }
    ]
}