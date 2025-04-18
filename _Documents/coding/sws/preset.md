# `/sws create_preset` コマンドで使用するプリセットをカスタムする方法

`/sws create_preset` コマンドは、Stormworks サーバーの設定を簡単に作成するために、アドオン（Playlists）と Mod のプリセットを選択できる機能を提供します。このドキュメントでは、プリセットをカスタムする方法を解説します。

---

## 1. プリセットの定義ファイルの場所
プリセットは以下のファイルで定義されています。

**ファイルパス**:  
`commands/sws/sub_commands/utility/presets.js`

---

## 2. プリセットの構造
プリセットは以下の2つのカテゴリに分かれています：
- **アドオン（Playlists）プリセット**
- **Mod プリセット**

### アドオン（Playlists）プリセット
アドオンプリセットは、`addonPresets` 配列に定義されています。各プリセットは以下のプロパティを持ちます：

- `name`: プリセットの名前（UIに表示されるラベル）
- `description`: プリセットの説明（UIに表示される説明）
- `value`: 内部識別子（重複不可）
- `playlists`: `server_config.xml` の `<playlists>` に設定されるパスのリスト

#### 例:
```javascript
{
    name: "デフォルトミッション",
    description: "基本的な公式ミッションのセットです。",
    value: "default_missions",
    playlists: [
        "rom/data/missions/default_fish_survey",
        "rom/data/missions/default_railroad_signals",
        "rom/data/missions/default_resource_storage",
        "workshop/2636689639",
        "workshop/2317348717"
    ]
}
```

---

### Mod プリセット
Mod プリセットは、`modPresets` 配列に定義されています。各プリセットは以下のプロパティを持ちます：

- `name`: プリセットの名前（UIに表示されるラベル）
- `description`: プリセットの説明（UIに表示される説明）
- `value`: 内部識別子（重複不可）
- `mods`: `server_config.xml` の `<mods>` に設定される要素のリスト

#### `mods` の構造:
- `type`: `'published_id'` または `'path'`（ワークショップIDかローカルパスを指定）
- `value`: Mod のIDまたはパス

#### 例:
```javascript
{
    name: "ドライブ用Mod",
    description: "高速道路、追加タイヤなどを含みます。",
    value: "driving_mods",
    mods: [
        { type: 'published_id', value: "YOUR_HIGHWAY_MOD_ID" },
        { type: 'published_id', value: "YOUR_TIRE_MOD_ID" }
    ]
}
```

---

## 3. プリセットのカスタム方法

### ステップ 1: `presets.js` を編集
1. **ファイルを開く**:  
   `commands/sws/sub_commands/utility/presets.js` を開きます。

2. **新しいプリセットを追加**:  
   `addonPresets` または `modPresets` 配列に新しいプリセットを追加します。

#### アドオンプリセットの追加例:
```javascript
{
    name: "新しいミッションセット",
    description: "カスタムミッションを含むセットです。",
    value: "custom_missions",
    playlists: [
        "rom/data/missions/custom_mission_1",
        "rom/data/missions/custom_mission_2",
        "workshop/1234567890"
    ]
}
```

#### Mod プリセットの追加例:
```javascript
{
    name: "建築用Modセット",
    description: "建築に役立つModを含みます。",
    value: "building_mods",
    mods: [
        { type: 'published_id', value: "YOUR_BUILD_HELPER_MOD_ID" },
        { type: 'path', value: "mods/local_building_mod" }
    ]
}
```

---

### ステップ 2: サーバーを再起動
プリセットを編集した後、Discord Bot を再起動して変更を反映させます。

---

## 4. 注意点
- **`value` の重複を避ける**:  
  各プリセットの `value` は一意である必要があります。
  
- **パスの正確性**:  
  `playlists` や `mods` に指定するパスやIDが正しいことを確認してください。

- **UI 表示の制限**:  
  `name` と `description` はそれぞれ100文字以内に収めてください。

---

## 5. 動作確認
1. Discord で `/sws create_preset` コマンドを実行します。
2. 新しく追加したプリセットがドロップダウンメニューに表示されていることを確認します。
3. プリセットを選択してサーバー構成を作成し、正しく反映されているか確認します。

---

以上の手順で、`/sws create_preset` コマンドで使用するプリセットをカスタムできます。