(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FloatballConfig = api;
})(typeof window === 'object' ? window : globalThis, function () {
  const shapes = { cercle:'圆球', galet:'鹅卵石', squircle:'圆角方形', capsule:'胶囊', triangle:'圆角三角', hexagone:'六边形', nuage:'云朵', goutte:'水滴' };
  const expressions = { neutre:'平静', attentif:'专注', surpris:'惊讶', excite:'兴奋', heureux:'开心', hilare:'大笑', colere:'生气', triste:'难过', effraye:'受惊', mefiant:'怀疑', confus:'困惑', curieux:'好奇', fier:'得意', timide:'害羞', blase:'淡定', somnolent:'困倦' };
  const animations = Object.freeze({orbit:'轨道',burst:'爆散',comet:'彗星',play:'播放',thinking:'思考',alert:'跳动感叹号',exclaim:'感叹号',notify:'提醒',wink:'眨眼',wide:'惊讶',egg:'蛋形',hexagon:'六边形',sleep:'小憩',morph:'变形'});
  const defaults = Object.freeze({ mode:'normal', orientation:'center', shape:'cercle', expression:'neutre', color:'#53616d', followAccent:true, size:64, opacity:100, followPointer:true, reactions:true, idle:true, intensity:1, clickExpression:'heureux', contextExpression:'confus', hoverExpression:'curieux', dragExpression:'effraye' });
  const validators = {
    mode: v => ['normal','low','static'].includes(v),
    orientation: v => ['center','front'].includes(v),
    shape: v => typeof v === 'string' && Object.hasOwn(shapes,v),
    expression: v => typeof v === 'string' && Object.hasOwn(expressions,v),
    color: v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v),
    size: v => Number.isFinite(v) && v >= 48 && v <= 84,
    opacity: v => Number.isFinite(v) && v >= 35 && v <= 100,
    intensity: v => Number.isFinite(v) && v >= .5 && v <= 1.5,
  };
  for (const k of ['followAccent','followPointer','reactions','idle']) validators[k] = v => typeof v === 'boolean';
  for (const k of ['clickExpression','contextExpression','hoverExpression','dragExpression']) validators[k] = validators.expression;
  function validPatch(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length > 0 && Object.keys(value).every(k => Object.hasOwn(validators,k) && validators[k](value[k]));
  }
  function normalize(value) {
    const out = { ...defaults };
    if (value && typeof value === 'object') for (const k of Object.keys(defaults)) if (validators[k](value[k])) out[k] = value[k];
    return out;
  }
  return { shapes, expressions, animations, defaults, validPatch, normalize };
});
