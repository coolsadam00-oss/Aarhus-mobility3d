'use strict';
/** Narrow bridge between the sandboxed renderer and the main process (exposed as window.mobility). */
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('mobility', {
  info: () => ipcRenderer.invoke('app:info'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  loadDefaultDataset: () => ipcRenderer.invoke('dataset:loadDefault'),
  pickDataset: () => ipcRenderer.invoke('dataset:pick'),
  resetDataset: () => ipcRenderer.invoke('dataset:resetDefault'),
  fetchOsmDataset: () => ipcRenderer.invoke('dataset:fetchOsm'),

  listPacks: () => ipcRenderer.invoke('packs:list'),
  packPresets: () => ipcRenderer.invoke('packs:presets'),
  downloadPack: (area) => ipcRenderer.invoke('packs:download', area),
  cancelPackDownload: () => ipcRenderer.invoke('packs:cancel'),
  deletePack: (id) => ipcRenderer.invoke('packs:delete', id),
  packLog: (id) => ipcRenderer.invoke('packs:log', id),

  search: (q) => ipcRenderer.invoke('lookup:search', q),
  reverse: (lat, lon) => ipcRenderer.invoke('lookup:reverse', lat, lon),
  wiki: (tags) => ipcRenderer.invoke('lookup:wiki', tags),
  osmBuildingAt: (lat, lon) => ipcRenderer.invoke('lookup:osmAt', lat, lon),
  clearLookupCache: () => ipcRenderer.invoke('lookup:clearCache'),

  listComments: (wayId) => ipcRenderer.invoke('comments:list', wayId ?? null),
  addComment: (comment) => ipcRenderer.invoke('comments:add', comment),
  deleteComment: (id) => ipcRenderer.invoke('comments:delete', id),
  exportComments: (format) => ipcRenderer.invoke('comments:export', format),

  activity: (limit) => ipcRenderer.invoke('activity:list', limit),
  saveScreenshot: (dataUrl) => ipcRenderer.invoke('screenshot:save', dataUrl),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  onProgress: on('progress'),
  onPackProgress: on('pack-progress'),
  onMenu: on('menu')
});
