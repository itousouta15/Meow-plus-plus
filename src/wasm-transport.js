import createCore from '../web/native/itou.js';

const core = await createCore();
export function request(message) {
  return JSON.parse(core.ccall('itou_request', 'string', ['string'], [JSON.stringify(message)]));
}
