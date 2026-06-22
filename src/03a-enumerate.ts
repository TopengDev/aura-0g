// CP2 (#1 make-or-break) - enumerate EVERY model served on 0G Compute testnet.
// Uses the READ-ONLY broker → needs NO wallet, NO funds. Answers: is there a text-to-image model?
import { createZGComputeNetworkReadOnlyBroker } from "./zg-compute.js";
import { GALILEO } from "./config.js";

const broker = await createZGComputeNetworkReadOnlyBroker(GALILEO.rpc);
console.log("Read-only broker created against", GALILEO.rpc, "\n");

const services = await broker.inference.listService();
console.log(`=== listService() → ${services.length} services ===\n`);

const fmtPrice = (p: bigint) => {
  try { return p.toString() + " (neuron) ≈ " + (Number(p) / 1e18).toExponential(3) + " 0G"; }
  catch { return String(p); }
};

for (const [i, s] of services.entries()) {
  console.log(`[${i}] model="${s.model}"`);
  console.log(`     serviceType : ${s.serviceType}`);
  console.log(`     verifiability: ${s.verifiability}   (TEE attestation type)`);
  console.log(`     provider    : ${s.provider}`);
  console.log(`     url         : ${s.url}`);
  console.log(`     inputPrice  : ${fmtPrice(s.inputPrice)}`);
  console.log(`     outputPrice : ${fmtPrice(s.outputPrice)}`);
  console.log(`     teeSigner   : ${s.teeSignerAddress} (ack=${s.teeSignerAcknowledged})`);
  console.log(`     additional  : ${s.additionalInfo || "(none)"}`);
  console.log("");
}

// The make-or-break classification
const imageish = services.filter(s =>
  /image|flux|sd|diffus|dalle|dall-e|stable|z-image|t2i|text-to-image/i.test(s.model + " " + s.serviceType + " " + s.additionalInfo)
);
const chat = services.filter(s => /chat/i.test(s.serviceType));
console.log("=== CLASSIFICATION ===");
console.log("serviceTypes present:", [...new Set(services.map(s => s.serviceType))].join(", "));
console.log("models present:", services.map(s => s.model).join(", "));
console.log(`chatbot services: ${chat.length}`);
console.log(`IMAGE/text-to-image services: ${imageish.length}`, imageish.map(s => s.model));
console.log(imageish.length > 0
  ? "\n✅ IMAGE MODEL FOUND ON TESTNET - the #1 path is GREEN, proceed to generate."
  : "\n🔴 NO IMAGE MODEL ON TESTNET - #1 make-or-break PIVOT TRIGGER. Image-gen not available on 0G Compute testnet.");
