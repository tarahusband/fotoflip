function noUnknown(val, fallback = '') {
  if (!val) return fallback;
  return /^unknown$/i.test(String(val).trim()) ? fallback : val;
}

function buildSku(itemId, meta) {
  const box = (meta.box || '').trim() || 'BOX-001';
  return `${box}-${String(itemId).padStart(3, '0')}`;
}

// ── Poshmark ──────────────────────────────────────────────────────────────────

function poshmarkCategoryMap(category) {
  const c = (category || '').toLowerCase();
  if (c.includes('necklace') || c.includes('pendant'))  return { dept: 'Women', cat: 'Jewelry',      subcat: 'Necklaces' };
  if (c.includes('bracelet'))                            return { dept: 'Women', cat: 'Jewelry',      subcat: 'Bracelets' };
  if (c.includes('earring'))                             return { dept: 'Women', cat: 'Jewelry',      subcat: 'Earrings' };
  if (c.includes('ring'))                                return { dept: 'Women', cat: 'Jewelry',      subcat: 'Rings' };
  if (c.includes('brooch') || c.includes('pin'))        return { dept: 'Women', cat: 'Jewelry',      subcat: 'Brooches' };
  if (c.includes('watch'))                               return { dept: 'Women', cat: 'Accessories',  subcat: 'Watches' };
  if (c.includes('tote'))                                return { dept: 'Women', cat: 'Bags',         subcat: 'Tote Bags' };
  if (c.includes('crossbody'))                           return { dept: 'Women', cat: 'Bags',         subcat: 'Crossbody Bags' };
  if (c.includes('wallet'))                              return { dept: 'Women', cat: 'Bags',         subcat: 'Wallets' };
  if (c.includes('clutch'))                              return { dept: 'Women', cat: 'Bags',         subcat: 'Clutches & Wristlets' };
  if (c.includes('satchel'))                             return { dept: 'Women', cat: 'Bags',         subcat: 'Satchels' };
  if (c.includes('backpack'))                            return { dept: 'Women', cat: 'Bags',         subcat: 'Backpacks' };
  if (c.includes('handbag') || c.includes('purse'))     return { dept: 'Women', cat: 'Bags',         subcat: 'Hobos' };
  if (c.includes('shoe') || c.includes('boot') || c.includes('sandal') || c.includes('heel')) return { dept: 'Women', cat: 'Shoes', subcat: '' };
  if (c.includes('scarf'))                               return { dept: 'Women', cat: 'Accessories',  subcat: 'Scarves & Wraps' };
  if (c.includes('belt'))                                return { dept: 'Women', cat: 'Accessories',  subcat: 'Belts' };
  if (c.includes('sunglasses') || c.includes('sunglass') || c.includes('eyewear') || c.includes('glasses')) return { dept: 'Women', cat: 'Accessories', subcat: 'Sunglasses' };
  if (c.includes('lego'))                                return { dept: 'Kids',  cat: 'Toys',         subcat: 'Building Sets & Blocks' };
  if (c.includes('toy') || c.includes('game'))           return { dept: 'Kids',  cat: 'Toys',         subcat: 'Action Figures & Playsets' };
  return { dept: 'Women', cat: 'Jewelry', subcat: 'Necklaces' };
}

function poshmarkCondition(t) {
  const c = (t || '').toLowerCase();
  if (c.includes('nwt') || c === 'new with tags')              return 'NWT';
  if (c.includes('nwot') || c.includes('new without'))         return 'Like New';
  if (c.includes('excellent'))                                  return 'Like New';
  if (c.includes('very good') || c.includes('good'))           return 'Good';
  if (c.includes('fair') || c.includes('poor') || c.includes('damage')) return 'Fair';
  return 'Good';
}

function poshmarkColor(colorStr) {
  const c = (colorStr || '').toLowerCase().replace(/-tone$/,'').replace(/-tone\b/g,'').trim();
  if (!c || c === 'tone' || c === 'mixed' || c === 'various' || c === 'assorted') return '';
  if (c.includes('black'))                                          return 'Black';
  if (c.includes('white') || c.includes('ivory'))                  return 'White';
  if (c.includes('cream'))                                          return 'Cream';
  if (c.includes('gold') || c.includes('brass') || c.includes('copper'))  return 'Gold';
  if (c.includes('silver') || c.includes('chrome') || c.includes('pewter') || c.includes('rhodium')) return 'Silver';
  if (c.includes('pink') || c.includes('blush') || c.includes('rose') || c.includes('magenta') || c.includes('fuchsia')) return 'Pink';
  if (c.includes('red') || c.includes('burgundy') || c.includes('wine') || c.includes('maroon') || c.includes('crimson')) return 'Red';
  if (c.includes('orange') || c.includes('coral') || c.includes('peach') || c.includes('amber')) return 'Orange';
  if (c.includes('yellow') || c.includes('lemon') || c.includes('mustard')) return 'Yellow';
  if (c.includes('teal') || c.includes('green') || c.includes('olive') || c.includes('emerald') || c.includes('sage') || c.includes('mint')) return 'Green';
  if (c.includes('blue') || c.includes('navy') || c.includes('cobalt') || c.includes('indigo') || c.includes('sapphire')) return 'Blue';
  if (c.includes('purple') || c.includes('violet') || c.includes('lavender') || c.includes('plum') || c.includes('amethyst')) return 'Purple';
  if (c.includes('brown') || c.includes('tan') || c.includes('beige') || c.includes('nude') || c.includes('tortoise') || c.includes('camel')) return 'Brown';
  if (c.includes('gray') || c.includes('grey') || c.includes('charcoal') || c.includes('ash')) return 'Gray';
  return '';
}

function poshmarkSize(category) {
  const c = (category || '').toLowerCase();
  if (c.includes('shoe') || c.includes('boot') || c.includes('sandal')) return '';
  return 'OS';
}

const POSHMARK_HEADERS = ['SKU','ProductID (GTIN)','Title','Description','Department','Category','Sub-category','Quantity','Size','Condition','Brand','Color1','Color2','VariantGroupID','VariantType','VariantAttribute','Style Tag1','Style Tag2','Style Tag3','Orig price','Listing price','Shipping Discount','Price Floor Percent','Minimum Price','Availability','Drop time','Other info','Copy Listing?','Update Existing SKU?','NEW SKU','Primary image','Alt image 1','Alt image 2','Alt image 3','Alt image 4','Alt image 5','Alt image 6','Alt image 7','Alt image 8','Alt image 9','Alt image 10','Alt image 11','Alt image 12','Alt image 13','Alt image 14','Alt image 15'];

function buildPoshmarkRow(item, meta, imageUrl, q) {
  const { dept, cat, subcat } = poshmarkCategoryMap(meta.category || '');
  const condition  = poshmarkCondition(meta.conditionText);
  const title      = noUnknown((meta.title || `${noUnknown(meta.brand, 'Item')} ${meta.category || ''}`.trim()), 'Item').slice(0, 80);
  const description = noUnknown((meta.description || meta.conditionNotes || ''), '').replace(/\n/g, ' ').slice(0, 1490);
  const price      = parseFloat(meta.suggestedPrice) || 25;
  const origPrice  = parseFloat(meta.msrp) || Math.round(price * 2);
  const sku        = buildSku(item.id, meta);
  const tags       = Array.isArray(meta.tags) ? meta.tags : [];
  const size       = poshmarkSize(meta.category);
  const rawColor   = meta.color || '';
  const colorParts = rawColor.split(/\s*[—–\-\/,]\s*/);
  const firstIsMulti = /multi|mixed|rainbow|various|assorted/i.test(colorParts[0]);
  let color1, color2;
  if (firstIsMulti) {
    color1 = (colorParts[1] ? poshmarkColor(colorParts[1]) : '') || 'Gold';
    color2 = '';
  } else {
    color1 = poshmarkColor(colorParts[0]) || (colorParts[1] ? poshmarkColor(colorParts[1]) : '') || 'Gold';
    const c2 = colorParts[1] ? poshmarkColor(colorParts[1]) : '';
    color2 = (c2 && c2 !== color1) ? c2 : '';
  }
  const row = new Array(46).fill('');
  row[0]  = q(sku);
  row[2]  = q(title);
  row[3]  = q(description);
  row[4]  = q(dept);
  row[5]  = q(cat);
  row[6]  = q(subcat);
  row[7]  = 1;
  row[8]  = q(size);
  row[9]  = q(condition);
  row[10] = q(noUnknown(meta.brand));
  row[11] = q(color1);
  row[12] = q(color2);
  row[16] = q((tags[0] || '').slice(0, 25));
  row[17] = q((tags[1] || '').slice(0, 25));
  row[18] = q((tags[2] || '').slice(0, 25));
  row[19] = origPrice;
  row[20] = price;
  row[24] = 'For Sale';
  row[26] = q(meta.box || '');
  row[30] = q(imageUrl);
  return row.join(',');
}

// ── Whatnot ───────────────────────────────────────────────────────────────────

function whatnotCategoryMap(cat) {
  if (cat.includes('necklace') || cat.includes('pendant') || cat.includes('charm')) return { whatnotCat: 'Jewelry', whatnotSub: 'Contemporary Costume' };
  if (cat.includes('bracelet'))  return { whatnotCat: 'Jewelry', whatnotSub: 'Contemporary Costume' };
  if (cat.includes('earring'))   return { whatnotCat: 'Jewelry', whatnotSub: 'Contemporary Costume' };
  if (cat.includes('ring'))      return { whatnotCat: 'Jewelry', whatnotSub: 'Contemporary Costume' };
  if (cat.includes('brooch') || cat.includes('pin')) return { whatnotCat: 'Jewelry', whatnotSub: 'Vintage & Antique Jewelry' };
  if (cat.includes('watch'))     return { whatnotCat: 'Jewelry', whatnotSub: 'Contemporary Costume' };
  if (cat.includes('jewel'))     return { whatnotCat: 'Jewelry', whatnotSub: 'Contemporary Costume' };
  if (cat.includes('tote') || cat.includes('crossbody') || cat.includes('wallet') || cat.includes('clutch') || cat.includes('satchel') || cat.includes('backpack') || cat.includes('handbag') || cat.includes('purse')) return { whatnotCat: 'Bags & Accessories', whatnotSub: 'Midrange & Fashion Bags' };
  if (cat.includes('toy') || cat.includes('lego')) return { whatnotCat: 'Action Figures', whatnotSub: 'Other Action Figures' };
  if (cat.includes('collectible')) return { whatnotCat: 'Jewelry', whatnotSub: 'Contemporary Costume' };
  if (cat.includes('accessory') || cat.includes('accessories')) return { whatnotCat: 'Jewelry', whatnotSub: 'Contemporary Costume' };
  return { whatnotCat: 'Jewelry', whatnotSub: 'Contemporary Costume' };
}

function whatnotDescription(meta) {
  const full    = meta.description || meta.conditionNotes || '';
  const hook    = full.split('\n').find(l => l.trim().length > 0) || full.slice(0, 200);
  const condition = meta.conditionNotes ? meta.conditionNotes.split('.')[0].trim() + '.' : '';
  return `${hook.trim()} ${condition} Final sale — no returns/exchanges due to item switchouts on lots.`.trim();
}

function whatnotCondition(t) {
  const c = (t || '').toLowerCase();
  if (c.includes('nwt') || c.includes('new with tag'))      return 'New with box';
  if (c.includes('nwot') || c.includes('new without tag'))  return 'New without box';
  if (c.includes('excellent') || c.includes('very good'))   return 'Pre-owned - Excellent';
  if (c.includes('good'))                                    return 'Pre-owned - Good';
  if (c.includes('fair'))                                    return 'Pre-owned - Fair';
  if (c.includes('poor'))                                    return 'Pre-owned - Damaged';
  return 'Pre-owned - Good';
}

function whatnotShipping() {
  return '4-7 oz';
}

// ── Etsy ──────────────────────────────────────────────────────────────────────

function etsyCategoryMap(category) {
  const c = category.toLowerCase();
  if (c.includes('necklace') || c.includes('pendant'))  return { etsyTaxonomyId: 1229 };
  if (c.includes('bracelet'))                            return { etsyTaxonomyId: 1232 };
  if (c.includes('earring'))                             return { etsyTaxonomyId: 1233 };
  if (c.includes('ring'))                                return { etsyTaxonomyId: 1230 };
  if (c.includes('brooch') || c.includes('pin'))        return { etsyTaxonomyId: 1234 };
  if (c.includes('watch'))                               return { etsyTaxonomyId: 164  };
  if (c.includes('jewel') || c.includes('charm'))       return { etsyTaxonomyId: 1228 };
  if (c.includes('tote') || c.includes('handbag') || c.includes('purse') || c.includes('bag')) return { etsyTaxonomyId: 1716 };
  if (c.includes('wallet'))                              return { etsyTaxonomyId: 1717 };
  if (c.includes('backpack'))                            return { etsyTaxonomyId: 1720 };
  return { etsyTaxonomyId: 1 };
}

module.exports = {
  noUnknown,
  buildSku,
  POSHMARK_HEADERS,
  buildPoshmarkRow,
  poshmarkCategoryMap,
  poshmarkCondition,
  poshmarkColor,
  poshmarkSize,
  whatnotCategoryMap,
  whatnotDescription,
  whatnotCondition,
  whatnotShipping,
  etsyCategoryMap,
};
