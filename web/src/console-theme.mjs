// Warm neutral palette selectively adapted from the Management Center.
// See THIRD_PARTY_NOTICES.md for source revision and MIT license.
export function consoleTheme(dark, theme) {
  const bg = dark ? '#151412' : '#faf9f5';
  const surface = dark ? '#1d1b18' : '#fffdf9';
  const secondary = dark ? '#262320' : '#f0eee8';
  const border = dark ? '#3a3530' : '#e3e1db';
  const text = dark ? '#f6f4f1' : '#2d2a26';
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: dark ? '#bcb4a9' : '#625c55',
      colorLink: dark ? '#d1c8bc' : '#625c55',
      colorInfo: dark ? '#bcb4a9' : '#625c55',
      colorSuccess: '#15966c', colorError: '#c65746',
      colorSuccessText: dark ? '#6ee7b7' : '#087451',
      colorBgLayout: bg, colorBgContainer: surface,
      colorBgElevated: dark ? '#2a2723' : '#fffdf9',
      colorBorder: border, colorBorderSecondary: border,
      colorText: text, colorTextSecondary: dark ? '#c9c3bb' : '#6d6760',
      borderRadius: 8, controlHeight: 34,
      fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
    },
    components: {
      Layout: {bodyBg: bg, headerBg: bg, siderBg: bg, footerBg: bg},
      Menu: {itemBg: bg, itemSelectedBg: secondary, itemSelectedColor: text, itemHoverBg: secondary, itemHeight: 42, iconSize: 18},
      Card: {headerFontSize: 15, headerHeight: 56, bodyPadding: 20},
      Table: {headerBg: secondary, cellPaddingBlock: 14, cellPaddingInline: 16},
      Button: {primaryColor: dark ? '#151412' : '#ffffff', primaryShadow: 'none', defaultShadow: 'none'},
      Segmented: {trackBg: secondary, itemSelectedBg: surface},
      Tag: {colorSuccess: dark ? '#6ee7b7' : '#087451', colorError: dark ? '#f1b0a6' : '#b54233'},
    },
  };
}
