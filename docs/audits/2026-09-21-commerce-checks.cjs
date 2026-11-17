// Read-only audit reproductions. All controller dependencies are fakes.
// Run from the repository root: node docs/audits/2026-09-21-commerce-checks.cjs
// These assertions confirm current defects; invert them when implementing fixes.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const source = fs.readFileSync('backend/src/controllers/orderController.js', 'utf8');
function load(overrides = {}) {
  const mocks = {
    'express-async-handler': fn => fn, crypto,
    mongoose: { isValidObjectId: () => false },
    '../models/Cart': {}, '../models/Order': {}, '../models/Product': {}, '../models/User': {},
    '../middleware/upload': {}, '../config/mail': { sendMail: async () => {} },
    '../services/shiprocket': {}, '../services/razorpay': {}, ...overrides,
  };
  const ctx = vm.createContext({ exports: {}, console: { log(){},warn(){},error(){} }, process: {env:{}}, Buffer, require: name => {
    if (!(name in mocks)) throw new Error('Unexpected dependency '+name);
    return mocks[name];
  }});
  vm.runInContext(source, ctx);
  vm.runInContext('sendCustomerStatusEmail = async () => {}; emailSellersForOrder = async () => {};', ctx);
  return ctx;
}
const response = () => ({statusCode:200,status(n){this.statusCode=n;return this;},json(x){this.body=x;return this;}});
(async () => {
  let captured;
  const secret='audit-only-fake-secret', orderId='order_fake_low', paymentId='pay_fake_low';
  const signature=crypto.createHmac('sha256',secret).update(orderId+'|'+paymentId).digest('hex');
  const c1=load({'../models/Order':{findOne:async()=>null}, '../services/razorpay':{
    verifyCheckoutSignature: p => p.razorpay_signature===crypto.createHmac('sha256',secret).update(p.razorpay_order_id+'|'+p.razorpay_payment_id).digest('hex'),
    getPayment:async()=>({amount:10000,currency:'INR',status:'captured',order_id:orderId}),
    describePayment: () => ({method:'upi'}),
  }});
  c1.currentCart={total:50000,itemsTotal:50000,shippingFee:0};
  c1.capture=x=>{captured=x;return x;};
  vm.runInContext('buildOrderPayload = async () => currentCart; finalizeOrder = async p => capture(p);',c1);
  await c1.exports.razorpayVerify({user:{_id:'buyer'},body:{addressId:'addr',razorpay_order_id:orderId,razorpay_payment_id:paymentId,razorpay_signature:signature}},response());
  assert.equal(captured.total,50000); assert.equal(captured.paymentStatus,'paid');
  console.log('CONFIRMED: INR 100 payment accepted for current INR 50000 cart as paid.');

  let refundCalls=0;
  function refundOrder(){const r={refundStatus:'requested',refundMethod:'razorpay',refundAmount:100,reasonCode:'test'};return {razorpayPaymentId:'fake',orderNumber:'fake',returnRequests:{id:()=>r},save:async()=>{}};}
  const c2=load({'../models/Order':{findOne:async()=>refundOrder()},'../services/razorpay':{refundPayment:async()=>{refundCalls++;return {id:'refund'+refundCalls};}}});
  await Promise.all([1,2].map(()=>c2.exports.adminProcessRefund({params:{reqId:'same'},user:{_id:'admin'},body:{}},response())));
  assert.equal(refundCalls,2);
  console.log('CONFIRMED: concurrent handlers initiate two refunds for one request.');

  let restored=0;
  const ret={_id:'leg',status:'returned'};
  const rr={seller:'seller',status:'approved',kind:'return',returnShipmentEntryId:'leg',items:[{product:'p',quantity:1}],refundStatus:'not-requested'};
  const ro={_id:'o',items:[{product:'p',price:100}],sellerShipments:[ret],returnRequests:{id:()=>rr},save:async()=>{}};
  const c3=load({'../models/Order':{findOne:async()=>ro},'../models/Product':{updateOne:async(q,u)=>{restored+=u.$inc.stock||0;}}});
  const req3={params:{id:'o',reqId:'r'},user:{_id:'seller'},body:{ok:true}};
  await c3.exports.sellerVerifyReturn(req3,response()); await c3.exports.sellerVerifyReturn(req3,response());
  assert.equal(restored,2);
  console.log('CONFIRMED: verifying one returned unit twice restores two units.');

  const shipments=[];
  const sellers=['A','B'].map(s=>({_id:s,slug:s,kyc:{shiprocket:{pickupLocation:s}}}));
  const so={_id:'o',orderNumber:'TIN-2026-000001',items:sellers.map(s=>({seller:s._id,product:'p'+s._id,name:'item',price:100,quantity:1,subtotal:100})),shippingAddress:{},paymentMethod:'cod',sellerShipments:[{seller:'A',status:'failed'},{seller:'B',kind:'forward',status:'shipped',shipmentId:'existingB'}],save:async()=>{}};
  const c4=load({'../models/Order':{findOne:async()=>so},'../models/User':{find:()=>({select:async()=>sellers})},'../models/Product':{find:()=>({select:async()=>[]})},'../services/shiprocket':{createOrder:async p=>{shipments.push(p.pickup_location);return {order_id:'fake',shipment_id:'fake'};}}});
  await c4.exports.sellerRetryPush({params:{id:'o'},user:{_id:'A'}},response());
  assert.deepEqual(shipments,['A','B']); assert.equal(so.sellerShipments.filter(s=>s.seller==='B').length,2);
  console.log('CONFIRMED: seller A retry creates new shipments for both A and already-shipped B.');

  const wo={status:'shipped',sellerShipments:[{kind:'forward',seller:'A',awbCode:'A',status:'shipped'},{kind:'forward',seller:'B',awbCode:'B',status:'shipped'}],save:async()=>{}};
  let webhook;
  const wctx=vm.createContext({require:name=>({'express':{Router:()=>({post:(url,fn)=>{webhook=fn;}})},crypto,'express-async-handler':fn=>fn,'../models/Order':{findOne:async()=>wo},'../models/User':{}}[name]),module:{exports:{}},console:{log(){},warn(){},error(){}},process:{env:{NODE_ENV:'production',SHIPROCKET_WEBHOOK_TOKEN:'fake'}},Buffer});
  vm.runInContext(fs.readFileSync('backend/src/routes/webhookRoutes.js','utf8'),wctx);
  await webhook({get:()=> 'fake',body:{awb:'A',current_status_id:7,current_status:'Delivered'}},response());
  assert.equal(wo.status,'delivered'); assert.equal(wo.sellerShipments[1].status,'shipped');
  console.log('CONFIRMED: first seller delivery marks entire multi-seller order delivered.');

  let fileHandler, fetchedKey, served;
  const fctx=vm.createContext({module:{exports:{}},console,Buffer,process:{env:{AWS_ACCESS_KEY_ID:'fake',AWS_SECRET_ACCESS_KEY:'fake',AWS_REGION:'fake',S3_BUCKET_NAME:'fake'}},require:name=>{
    if(name==='express')return {Router:()=>({get:(url,fn)=>{fileHandler=fn;}})};
    if(name==='@aws-sdk/client-s3')return {
      S3Client:class {async send(cmd){fetchedKey=cmd.input.Key;return {ContentType:'application/pdf',Body:{async *[Symbol.asyncIterator](){yield Buffer.from('synthetic-private-document');}}};}},
      GetObjectCommand:class {constructor(input){this.input=input;}},HeadObjectCommand:class {},
    };
    throw new Error('Unexpected dependency '+name);
  }});
  vm.runInContext(fs.readFileSync('backend/src/routes/fileRoutes.js','utf8'),fctx);
  await fileHandler({params:{key:['sellers','audit-seller','kyc','synthetic.pdf']},headers:{}},{setHeader(){},end(body){served=body.toString();}});
  assert.equal(fetchedKey,'sellers/audit-seller/kyc/synthetic.pdf');
  assert.equal(served,'synthetic-private-document');
  console.log('CONFIRMED: unauthenticated file route serves a private KYC key using fake S3.');

  const { createRequire }=require('node:module');
  const path=require('node:path');
  const frontRequire=createRequire(path.resolve('frontend/package.json'));
  const ts=frontRequire('typescript');
  const compiled=ts.transpileModule(fs.readFileSync('frontend/components/common/RichTextView.tsx','utf8'),{
    compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,esModuleInterop:true},
  }).outputText;
  const hctx=vm.createContext({exports:{},require:name=>name==='dompurify'?{sanitize(){throw new Error('SSR sanitizer unexpectedly called');}}:frontRequire(name)});
  vm.runInContext(compiled,hctx);
  const html=frontRequire('react-dom/server').renderToStaticMarkup(frontRequire('react').createElement(hctx.exports.default,{html:'<img src="missing-audit-image" onerror="window.__auditOnly=true">'}));
  assert.ok(html.includes('onerror="window.__auditOnly=true"'));
  console.log('CONFIRMED: SSR emits the supplied HTML event handler unsanitized (markup only; no browser execution).');
})().catch(e=>{console.error(e);process.exitCode=1;});
