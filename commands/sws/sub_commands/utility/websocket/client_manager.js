// commands/sws/sub_commands/utility/client_manager.js

const { log } = require('../../../../../utility/text_chat_logger');

/**
 * 接続中のクライアント情報を管理するMap
 * キー: clientId (string, UUID)
 * 値: clientInfo (object)
 * {
 * clientId: string,
 * physicalServerId: string, // ★ トークンそのもの
 * token: string,           // ★ トークンそのもの (重複だが明確化のため)
 * ws: WebSocket,
 * ip: string,
 * creatorId: string,
 * tokenCreatedAt: string | undefined,
 * lastPingTime: number | null,
 * ping: number | null,
 * isAlive: boolean,
 * pingIntervalId: NodeJS.Timeout | null,
 * pongTimeoutId: NodeJS.Timeout | null,
 * synced: boolean
 * }
 */
const wsClients = new Map();

/**
 * 新しいクライアント情報をMapに追加する
 * @param {object} clientInfo - 追加するクライアント情報オブジェクト
 */
function addClient(clientInfo) {
    if (!clientInfo || !clientInfo.clientId) {
        log('ERROR', '[ClientManager] 無効なクライアント情報を追加しようとしました。', { data: clientInfo });
        return;
    }
    if (wsClients.has(clientInfo.clientId)) {
        log('WARN', `[ClientManager] 既に存在する ClientID ${clientInfo.clientId} を追加しようとしました。上書きします。`, { data: clientInfo });
    }
    wsClients.set(clientInfo.clientId, clientInfo);
    log('DEBUG', `[ClientManager] クライアントを追加しました: ClientID=${clientInfo.clientId}, PhysicalID=${clientInfo.physicalServerId}, IP=${clientInfo.ip}`, { data: { count: wsClients.size }});
}

/**
 * 指定されたクライアントIDの情報をMapから削除する
 * @param {string} clientId - 削除するクライアントのID
 * @returns {boolean} 削除が成功したかどうか
 */
function removeClient(clientId) {
    if (!clientId) {
        log('WARN', '[ClientManager] ClientID なしでクライアントを削除しようとしました。');
        return false;
    }
    const deleted = wsClients.delete(clientId);
    if (deleted) {
        log('DEBUG', `[ClientManager] クライアントを削除しました: ClientID=${clientId}`, { data: { count: wsClients.size }});
    } else {
        // log('WARN', `[ClientManager] 削除対象のクライアントが見つかりませんでした: ClientID=${clientId}`);
        // 切断処理などで複数回呼ばれる可能性があるのでWARNは抑制しても良い
    }
    return deleted;
}

/**
 * 指定されたクライアントIDに対応するクライアント情報を取得する
 * @param {string} clientId - 取得するクライアントのID
 * @returns {object | undefined} クライアント情報オブジェクト、または見つからない場合は undefined
 */
function getClient(clientId) {
    if (!clientId) return undefined;
    return wsClients.get(clientId);
}

/**
 * 指定された物理サーバーIDに対応するクライアント情報を検索する
 * （同じ物理サーバーからの多重接続チェックや、物理サーバー単位での操作に利用）
 * @param {string} physicalServerId - 検索する物理サーバーのID (例: 'creatorId-ip')
 * @returns {object | undefined} 見つかったクライアント情報オブジェクト、または見つからない場合は undefined
 */
function findClientByPhysicalId(physicalServerId) {
    if (!physicalServerId) return undefined;
    for (const clientInfo of wsClients.values()) {
        if (clientInfo.physicalServerId === physicalServerId) {
            return clientInfo;
        }
    }
    return undefined;
}

/**
 * ★ 新規追加: 指定されたトークンを持つクライアント情報を検索する
 * @param {string} token - 検索するトークン文字列
 * @returns {object | undefined} 見つかったクライアント情報オブジェクト、または見つからない場合は undefined
 */
function findClientByToken(token) {
    if (!token) return undefined;
    for (const clientInfo of wsClients.values()) {
        // clientInfo に token プロパティがあると仮定
        if (clientInfo.token === token) {
            return clientInfo;
        }
    }
    return undefined;
}

/**
 * 現在接続中の全てのクライアント情報オブジェクトを配列で取得する
 * @returns {Array<object>} クライアント情報オブジェクトの配列
 */
function getAllClients() {
    return Array.from(wsClients.values());
}

/**
 * 接続中のクライアントリストを整形して取得する (主にコマンドファイル向け)
 * 現時点では getAllClients と同じだが、将来的に返す情報を絞り込むなどの変更が可能
 * @returns {Array<object>} 整形されたクライアント情報の配列 (例: wsオブジェクトを除外するなど)
 */
function getConnectedClients() {
    // 現時点では getAllClients と同じ情報を返す
    // 必要に応じて、ws オブジェクトなど外部に渡すべきでない情報を除外する処理を追加
    return getAllClients().map(clientInfo => ({
        clientId: clientInfo.clientId,
        physicalServerId: clientInfo.physicalServerId,
        token: clientInfo.token,
        ip: clientInfo.ip,
        creatorId: clientInfo.creatorId,
        ping: clientInfo.ping,
        synced: clientInfo.synced, // 同期状態も渡す
        // ws, lastPingTime, isAlive, intervalId などは通常不要
    }));
}


/**
 * 管理している全てのクライアント情報をクリアする (サーバー停止時などに使用)
 */
function clearAllClients() {
    const count = wsClients.size;
    wsClients.clear();
    log('INFO', `[ClientManager] 全てのクライアント情報 (${count}件) をクリアしました。`);
}

module.exports = {
    addClient,
    removeClient,
    getClient,
    findClientByPhysicalId,
    findClientByToken,
    getAllClients,
    getConnectedClients,
    clearAllClients,
    // デバッグ用に Map 自体をエクスポートすることも可能だが、通常は避ける
    // _clientsMap: clients
};