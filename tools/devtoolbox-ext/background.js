/* DevToolbox 后台：右键菜单切换三种形态（弹窗由 action 默认提供） */
'use strict';

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({
      id: 'open-side',
      title: '在侧边栏中打开 DevToolbox',
      contexts: ['action']
    });
    chrome.contextMenus.create({
      id: 'open-tab',
      title: '在标签页中打开 DevToolbox（全屏）',
      contexts: ['action']
    });
  });
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  var windowId = tab && tab.windowId;
  if (info.menuItemId === 'open-side') {
    try {
      chrome.sidePanel.open(windowId ? { windowId: windowId } : undefined);
    } catch (e) {
      /* sidePanel 不可用时降级为标签页 */
      chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
    }
  } else if (info.menuItemId === 'open-tab') {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  }
});
