'use strict';

const isValidPairingNumber = number => typeof number === 'string' && /^\d{8,15}$/.test(number);

function installPairingCodeHandler(sock, {
    creds,
    pairingNumber,
    onCode,
    onError,
}) {
    let requestAttempted = false;

    const handleConnectionUpdate = async update => {
        if (!update?.qr || requestAttempted || creds?.registered !== false || !pairingNumber) return;

        requestAttempted = true;
        if (!isValidPairingNumber(pairingNumber)) {
            onError(new Error('PAIRING_NUMBER must contain 8–15 digits only, including the country calling code.'));
            return;
        }
        if (typeof sock.requestPairingCode !== 'function') {
            onError(new Error('The installed Baileys socket does not support pairing codes.'));
            return;
        }

        try {
            const code = await sock.requestPairingCode(pairingNumber);
            onCode(code);
        } catch {
            onError(new Error('MUSHII could not request a pairing code. Check the connection and try again.'));
        }
    };

    sock.ev.on('connection.update', handleConnectionUpdate);
    return handleConnectionUpdate;
}

module.exports = {
    isValidPairingNumber,
    installPairingCodeHandler,
};
