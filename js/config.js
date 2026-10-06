/* BIMO configuration — product catalogue. Agent logins live on the server (server/users.json). */
window.BIMO_CONFIG = {
  appName: 'BIMO',

  // Product catalogue, as listed on the SUD Life product page.
  categories: [
    {
      name: 'Savings Plans',
      products: [
        { id: 1050, name: 'SUD Life Fortune Plus', featured: true },
        { id: 1003, name: 'Star Union Dai-ichi Guaranteed Money Back Plan' },
        { id: 1010, name: 'SUD Life AADARSH' },
        { id: 1019, name: 'SUD Life Samriddhi' },
        { id: 1024, name: 'SUD Life Century Star' },
        { id: 1026, name: 'POS - SUD Life Sanchay' },
        { id: 1032, name: 'SUD Life Century Royale' },
        { id: 1035, name: 'SUD Life Fortune Royale' },
        { id: 1036, name: 'SUD Life Century Gold' },
        { id: 1040, name: 'SUD Life Century Income' },
        { id: 1041, name: 'SUD Life Centurion' },
        { id: 1044, name: 'SUD Life Guarantee Royale' },
        { id: 1051, name: 'SUD Life Smart Income Plan' },
        { id: 1052, name: 'SUD Life Smart Term Return of Premium' },
        { id: 1055, name: 'SUD Life Century Assure' },
        { id: 1056, name: 'SUD Life Assured Returns Plan' }
      ]
    },
    {
      name: 'Wealth Plans',
      products: [
        { id: 1012, name: 'SUD Life Wealth Builder Plan' },
        { id: 1027, name: 'SUD Life Wealth Creator' },
        { id: 1031, name: 'SUD Life e-Wealth Royale' },
        { id: 1042, name: 'SUD Life STAR TULIP' },
        { id: 1048, name: 'SUD Life International Wealth Creator' },
        { id: 1057, name: 'SUD Life Wealth PRO' }
      ]
    },
    {
      name: 'Protection Plans',
      products: [
        { id: 1029, name: 'SUD Life Saral Jeevan Bima' },
        { id: 1043, name: 'SUD Life e-Lifeline Term Insurance Plan' },
        { id: 1046, name: 'SUD Life Simple Term Plan' },
        { id: 1049, name: 'SUD Life Smart Term Plan' },
        { id: 1054, name: 'SUD Life Sarva Suraksha Bima Plan' }
      ]
    },
    {
      name: 'Retirement Plans',
      products: [
        { id: 1015, name: 'SUD Life Immediate Annuity Plus' },
        { id: 1030, name: 'SUD Life Saral Pension' },
        { id: 1039, name: 'SUD Life Retirement Royale' },
        { id: 1045, name: 'SUD Life Pension Plus' },
        { id: 1047, name: 'SUD Life Smart Guaranteed Pension Plan' }
      ]
    },
    {
      name: 'Health Plans',
      products: [
        { id: 1037, name: 'SUD Life Smart Healthcare' },
        { id: 1053, name: 'SUD Life Health Assure' }
      ]
    },
    {
      name: 'Group Products',
      products: [
        { id: 1033, name: 'SUD Life Sampoorna Loan Suraksha Plus' }
      ]
    }
  ]
};
