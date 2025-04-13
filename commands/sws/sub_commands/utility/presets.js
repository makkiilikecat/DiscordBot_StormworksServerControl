// commands/utility/sws/utils/presets.js

module.exports = {
    /**
     * アドオン（Playlists）プリセットの定義
     */
    addonPresets: [
        {
            name: "デフォルトミッション", // ドロップダウン表示名
            description: "基本的な公式ミッションのセットです。", // ドロップダウン説明
            value: "default_missions", // 内部識別子 (重複不可)
            // server_config.xml の <playlists> に入る <path path="..."/> の path 属性値のリスト
            playlists: [
                "rom/data/missions/default_fish_survey",
                "rom/data/missions/default_railroad_signals",
                "rom/data/missions/default_resource_storage",
                // 必要に応じてワークショップIDなどを追加
                 "workshop/2636689639", // 例
                 "workshop/2317348717"  // 例
            ]
        },
        {
            name: "レースパック",
            description: "サーキットとタイム計測アドオンを含みます。",
            value: "race_pack",
            playlists: [
                "workshop/YOUR_CIRCUIT_ADDON_ID", // ← 実際のワークショップIDに置き換える
                "workshop/YOUR_TIME_TRIAL_ADDON_ID" // ← 実際のワークショップIDに置き換える
            ]
        },
        {
            name: "アドオンなし",
            description: "アドオンをロードしません。",
            value: "no_addons",
            playlists: [] // 空のリスト
        },
        // --- 他のアドオンプリセットを追加 ---
    ],

    /**
     * Modプリセットの定義
     */
    modPresets: [
        {
            name: "Modなし (バニラ)",
            description: "Modを一切使用しません。",
            value: "vanilla",
            // server_config.xml の <mods> に入る要素のリスト
            // type: 'published_id' または 'path'
            mods: [] // 空のリスト
        },
        {
            name: "ドライブ用Mod",
            description: "高速道路、追加タイヤなどを含みます。",
            value: "driving_mods",
            mods: [
                // 例: ワークショップModの場合
                { type: 'published_id', value: "YOUR_HIGHWAY_MOD_ID" }, // ← 実際のワークショップID
                { type: 'published_id', value: "YOUR_TIRE_MOD_ID" },    // ← 実際のワークショップID
                // 例: ローカルModの場合 (あまり一般的ではないかも)
                // { type: 'path', value: "mods/my_local_driving_mod" }
            ]
        },
        {
            name: "建築補助Mod",
            description: "建築に役立つModを含みます。",
            value: "building_mods",
            mods: [
                 { type: 'published_id', value: "YOUR_BUILD_HELPER_MOD_ID" },
                 // 他の建築系Mod ID
            ]
        },
        // --- 他のModプリセットを追加 ---
    ]
};