'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('klokd', {
  getConsentStatus:  ()          => ipcRenderer.invoke('klokd:getConsentStatus'),
  setConsent:        ()          => ipcRenderer.invoke('klokd:setConsent'),
  getTodaySummary:   ()          => ipcRenderer.invoke('klokd:getTodaySummary'),
  getTopApps:        ()          => ipcRenderer.invoke('klokd:getTopApps'),
  getWeekTrends:     ()          => ipcRenderer.invoke('klokd:getWeekTrends'),
  getInsights:       ()          => ipcRenderer.invoke('klokd:getInsights'),
  getAutoLaunchEnabled: ()       => ipcRenderer.invoke('klokd:getAutoLaunchEnabled'),
  setAutoLaunch:     (enabled)   => ipcRenderer.invoke('klokd:setAutoLaunch', enabled),
  getSettings:       ()          => ipcRenderer.invoke('klokd:getSettings'),
  setPollInterval:   (seconds)   => ipcRenderer.invoke('klokd:setPollInterval', seconds),
  getCategoriesYaml: ()          => ipcRenderer.invoke('klokd:getCategoriesYaml'),
  setCategoriesYaml: (content)   => ipcRenderer.invoke('klokd:setCategoriesYaml', content),
  recategoriseAll:   ()          => ipcRenderer.invoke('klokd:recategoriseAll'),
  exportData:        ()          => ipcRenderer.invoke('klokd:exportData'),
  deleteAllData:     ()          => ipcRenderer.invoke('klokd:deleteAllData'),
})
