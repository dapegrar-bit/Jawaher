import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {validateVat, validateProfile, preflightDocument, assertSignedEnvelope, envelopeFingerprint,
        sandboxAvailable, assertSimulationReady, validateSubmissionKind, callZatcaSimulation, ZATCA_SIM_BASE} from '../src/zatca/core.ts';
const profile={legalName:'منشأة اختبار',vatNumber:'300000000000003',crNumber:'1010000000',buildingNumber:'1234',street:'الملك',district:'السلام',city:'جدة',postalCode:'23456',countryCode:'SA',deviceLabel:'TEST-EGS'};
const xml='<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">'+ 'a'.repeat(95)+'</Invoice>';
const envelope={uuid:randomUUID(),invoiceHash:createHash('sha256').update(xml).digest('base64'),invoice:Buffer.from(xml).toString('base64')};
const env={ZATCA_SIM_ENABLED:'true',ZATCA_SIM_COMPANY_ID:'123',ZATCA_SIM_BINARY_SECURITY_TOKEN:'FAKE_TOKEN',ZATCA_SIM_SECRET:'FAKE_SECRET'};
test('seller VAT check uses SA format 15 digits',()=>{assert.equal(validateVat('300000000000003'),true);assert.equal(validateVat('300'),false);assert.equal(validateVat('100000000000001'),false)});
test('valid seller profile passes the preliminary check',()=>assert.deepEqual(validateProfile(profile),[]));
test('malformed building number and postal code rejected',()=>assert.equal(validateProfile({...profile,buildingNumber:'12',postalCode:'abcd1'}).length,2));
test('missing seller profile yields issue',()=>assert.ok(preflightDocument(null,{kind:'sale',status:'draft'}).length>2));
test('draft invoice never looks ready',()=>assert.match(preflightDocument(profile,{kind:'sale',status:'draft',invoiceCategory:'simplified',contactName:'عميل',lineCount:1,issueDate:'2026-10-20'}).join(' '),/مسودة/));
test('standard missing buyer tax number yields warning',()=>assert.match(preflightDocument(profile,{kind:'sale',status:'issued',invoiceCategory:'standard',contactName:'عميل',lineCount:1,issueDate:'2026-10-20'}).join(' '),/المشتري/));
test('document always requires signed XML and SDK even when prelim checks pass',()=>assert.match(preflightDocument(profile,{kind:'sale',status:'issued',invoiceCategory:'simplified',contactName:'عميل',lineCount:1,issueDate:'2026-10-20'}).join(' '),/SDK/));
test('signed envelope only sanity checks UBL structure',()=>assert.equal(assertSignedEnvelope(envelope).uuid,envelope.uuid));
test('envelope rejects invalid UUID',()=>assert.throws(()=>assertSignedEnvelope({...envelope,uuid:'bad'}),/UUID/));
test('envelope rejects invalid Base64',()=>assert.throws(()=>assertSignedEnvelope({...envelope,invoice:'!'}),/invoice/));
test('stable fingerprint uses SHA256',()=>assert.equal(envelopeFingerprint(envelope),createHash('sha256').update(envelope.invoice).digest('hex')));
test('credentials alone do not enable outbound',()=>assert.equal(sandboxAvailable('123',{...env,ZATCA_SIM_ENABLED:'false'}),false));
test('only matching company may simulate',()=>assert.equal(sandboxAvailable('other',env),false));
test('correct company simulation can be configured',()=>assert.equal(sandboxAvailable('123',env),true));
test('simulation guard denies when disabled',()=>assert.throws(()=>assertSimulationReady('bad',env),/معطل/));
test('standard invoice must use clearance',()=>{assert.throws(()=>validateSubmissionKind('reporting','standard'));assert.doesNotThrow(()=>validateSubmissionKind('clearance','standard'))});
test('simplified invoice must use reporting',()=>{assert.throws(()=>validateSubmissionKind('clearance','simplified'));assert.doesNotThrow(()=>validateSubmissionKind('reporting','simplified'))});
test('only allowlisted simulation URL is used',async()=>{
 const req=[];const mock=async(url,init)=>{req.push({url,init});return {status:200,text:async()=>'{"reportingStatus":"REPORTED"}'};};
 const res=await callZatcaSimulation('123','reporting',envelope,env,mock);
 assert.equal(res.httpStatus,200);assert.equal(req.length,1);assert.equal(req[0].url,ZATCA_SIM_BASE+'/invoices/reporting/single');
 assert.equal(req[0].init.headers['Accept-Version'],'V2');assert.match(req[0].init.headers.Authorization,/^Basic /);
});
test('disabled simulation never makes network request',async()=>{
 let called=false;
 await assert.rejects(callZatcaSimulation('bad','reporting',envelope,env,async()=>{called=true;}));
 assert.equal(called,false);
});
test('clearance uses mandatory clearance status',async()=>{
 let header;await callZatcaSimulation('123','clearance',envelope,env,async(_,init)=>{header=init.headers;return {status:400,text:async()=>'{"message":"bad"}'};});
 assert.equal(header['Clearance-Status'],'1');
});
