import { safeLoadJson } from './jsonutils';

describe('tryToFixJson', () => {
  it('should return null if the input is not a valid JSON string', () => {
    expect(safeLoadJson('')).toBeNull();
    expect(safeLoadJson('not a json string')).toBeNull();
  });

  it('should return the parsed object if the input is a valid JSON string', () => {
    const obj = { key: 'value' };
    expect(safeLoadJson(JSON.stringify(obj))).toEqual({ key: 'value' });
  });

  it('should parse invalid json', () => {
    const value = '{"key":"value"}"lastPropHash":"3H9ELF"}';
    expect(safeLoadJson(value)).toEqual({ key: 'value' });
  });
  it('should parse invalid json', () => {
    const value =
      '{"noiseKey":{"private":{"type":"Buffer","data":"qFDxKVA87w7+TvcVRfiMGd3O0x53HnvMbXQUl/jP1Xo="},"public":{"type":"Buffer","data":"qszWbQ107oiEOM62Ipv2sXMRhzfPN+ny9rFxdasjiA4="}},"pairingEphemeralKeyPair":{"private":{"type":"Buffer","data":"CIQFzNIBHeENeONBcWLxOZddCD2yTNCFqYQUsczpnlg="},"public":{"type":"Buffer","data":"gB046aofbCKQnbFZl3aWK+rGoqVhYB2cqG4CfTB1NDQ="}},"signedIdentityKey":{"private":{"type":"Buffer","data":"IE1mRO3Ec+h0zeK6XajVZS3fmHpKlVLa6uiLKC97PkI="},"public":{"type":"Buffer","data":"Qi7rIVHdoIiWAuRVYaENj1sWfxK0zqslMoH5xKcHeCc="}},"signedPreKey":{"keyPair":{"private":{"type":"Buffer","data":"AJnylKf9BfgDpk10VIZNOI1S3fb5kyQVqktwwJ/VQ3U="},"public":{"type":"Buffer","data":"b3Sgv+reNHXoCaF6UKqdR5O8y9a2eNtD2BrBSbgeLnY="}},"signature":{"type":"Buffer","data":"dpJc5ZCcgCJEKlPaKTBnzZNzoROoDpYQXU6MW/mmsgQNZoVEa2QSj5uv49L+xjpzz0/sQ48OCkogMUWVuDP2iQ=="},"keyId":1},"registrationId":247,"advSecretKey":"XNABqLVRwwySZk9QA/axtSvJnRqpeGBCx70StzmlS60=","processedHistoryMessages":[{"key":{"remoteJid":"5511937140620@s.whatsapp.net","fromMe":true,"id":"40318500476EC1CD686FD51CC333861A"},"messageTimestamp":1716567185},{"key":{"remoteJid":"5511937140620@s.whatsapp.net","fromMe":true,"id":"C7B8AED6A674B1FDBD6DF12E9B4A8260"},"messageTimestamp":1716567193}],"nextPreKeyId":189,"firstUnuploadedPreKeyId":189,"accountSyncCounter":1,"accountSettings":{"unarchiveChats":false},"deviceId":"5v8mNri1TM-15ujww7VTRA","phoneId":"7a500cf3-cb51-4a44-9903-a97bdf14669b","identityId":{"type":"Buffer","data":"JGYBQBa9r/cFY1ls02pOekV6nlw="},"registered":false,"backupToken":{"type":"Buffer","data":"VVOJJ/2hY0KV/aZ9cRkZFwhsNi8="},"registration":{},"account":{"details":"CNGD2LACEPf4wrIGGA8gACgA","accountSignatureKey":"D0yrhIf0hU1m192AcTVWw4q8WnFwDEcp9fCThkKWHVc=","accountSignature":"xIjOvPJeurMrjboW4C48MTDN6aRC2WFtFwLlrmi8mxXXSMl+QSU/8QP9zpTXmjOcFk90uOtjLT45TXZ9PrzvCw==","deviceSignature":"Qfqcvva8MUfxZBxvuHJw0mAQ1KASKJ85fLeP2sf5EmWPNMVFLvcn9PuIGomCKYduPcx15dWCfDlh2R0oV8mehQ=="},"me":{"id":"5511937140620:89@s.whatsapp.net","name":"Autoescola R3","lid":"61366492770351:89@lid"},"signalIdentities":[{"identifier":{"name":"5511937140620:89@s.whatsapp.net","deviceId":0},"identifierKey":{"type":"Buffer","data":"BQ9Mq4SH9IVNZtfdgHE1VsOKvFpxcAxHKfXwk4ZClh1X"}}],"platform":"smba","routingInfo":{"type":"Buffer","data":"CAIIDA=="},"lastAccountSyncTimestamp":1716572438,"myAppStateKeyId":"AAAAAMik"}"lastPropHash":"3H9ELF"}';
    expect(safeLoadJson(value)).toBeTruthy();
  });
});
