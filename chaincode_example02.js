/*
# Modified from code marbles_chaincode.js produced by IBM Corp. (Copyright IBM Corp. All Rights Reserved.)
# SPDX-License-Identifier: Apache-2.0
*/

'use strict';
const shim = require('fabric-shim');
const util = require('util');
const crypto = require('crypto');

let Chaincode = class {
	async Init(stub) {
		let ret = stub.getFunctionAndParameters();
		console.info(ret);
		console.info('=========== Simple Asset Chaincode ===========');
		return shim.success();
	}
	
	async Invoke(stub) {
		console.info('Transaction ID: ' + stub.getTxID());
		console.info(util.format('Args: %j', stub.getArgs()));
		
		let ret = stub.getFunctionAndParameters();
		console.info(ret);
		
		let method = this[ret.fcn];
		if (!method) {
			console.log('no function of name:' + ret.fcn + ' found');
			throw new Error('Received unknown function ' + ret.fcn + ' invocation');
		}
		try {
			let payload = await method(stub, ret.params, this);
			return shim.success(payload);
		} catch (err) {
			console.log(err);
			return shim.error(err);
		}
	}
	
	
	async initAsset(stub, args, thisClass) {
		if (args.length != 4) {
			throw new Error('Incorrect number of arguments. Expecting 4');
		}
		let id = args[0];
		let owner = args[1];
		let timestamp = args[2];
		let value = args[3];
		
		let assetState = await stub.getState(id);
		if (assetState.toString()){
			throw new error("Failed to add asset, ID already exists");
		}
		
		let asset = {};
		asset.doctype = 'asset';
		asset.id = id;
		asset.owner = owner;
		asset.timestamp = timestamp;
		asset.value = value;
		
		await stub.putState(id, Buffer.from(JSON.stringify(asset)));
		
		await thisClass.initContractInternal(stub, [crypto.createHash('sha1').update(id).digest('hex'), owner], thisClass);
		
		console.info('Finish init asset');
	}
	
	async readItem(stub, args, thisClass) {
		if (args.length != 1) {
			throw new Error('Incorrect number of arguments. Expecting ID of the item to query');
		}
		
		let id = args[0];
		if (!id) {
			throw new Error('ID must not be empty');
		}
		let assetAsbytes = await stub.getState(id); //get the marble from chaincode state
		if (!assetAsbytes.toString()) {
			let jsonResp = {};
			jsonResp.Error = 'Asset does not exist: ' + name;
			throw new Error(JSON.stringify(jsonResp));
		}
		console.info('=======================================');
		console.log(assetAsbytes.toString());
		console.info('=======================================');
		return assetAsbytes;
	}
	
	async transferAsset(stub, args, thisClass) {
		//   0       1
		// 'name', 'bob'
		if (args.length < 2) {
			throw new Error('Incorrect number of arguments. Expecting asset ID and owner')
		}
		
		let id = args[0];
		let newOwner = args[1].toLowerCase();
		console.info('- start transferAsset ', id, newOwner);
		
		let assetAsBytes = await stub.getState(id);
		if (!assetAsBytes || !assetAsBytes.toString()) {
			throw new Error('asset does not exist');
		}
		let assetToTransfer = {};
		try {
			assetToTransfer = JSON.parse(assetAsBytes.toString()); //unmarshal
		} catch (err) {
			let jsonResp = {};
			jsonResp.error = 'Failed to decode JSON of: ' + id;
			throw new Error(jsonResp);
		}
		console.info(assetToTransfer);
		assetToTransfer.owner = newOwner; //change the owner
		
		let assetJSONasBytes = Buffer.from(JSON.stringify(assetToTransfer));
		await stub.putState(id, assetJSONasBytes); //rewrite the marble
		
		console.info('- end transferAsset (success)');
	}
	
	async getAllResults(iterator, isHistory) {
		let allResults = [];
		while (true) {
			let res = await iterator.next();
			
			if (res.value && res.value.value.toString()) {
				let jsonRes = {};
				console.log(res.value.value.toString('utf8'));
				
				if (isHistory && isHistory === true) {
					jsonRes.TxId = res.value.tx_id;
					jsonRes.Timestamp = res.value.timestamp;
					jsonRes.IsDelete = res.value.is_delete.toString();
					try {
						jsonRes.Value = JSON.parse(res.value.value.toString('utf8'));
					} catch (err) {
						console.log(err);
						jsonRes.Value = res.value.value.toString('utf8');
					}
				} else {
					jsonRes.Key = res.value.key;
					try {
						jsonRes.Record = JSON.parse(res.value.value.toString('utf8'));
					} catch (err) {
						console.log(err);
						jsonRes.Record = res.value.value.toString('utf8');
					}
				}
				allResults.push(jsonRes);
			}
			if (res.done) {
				console.log('end of data');
				await iterator.close();
				console.info(allResults);
				return allResults;
			}
		}
	}
	
	async getQueryResultForQueryString(stub, queryString, thisClass) {
		
		console.info('- getQueryResultForQueryString queryString:\n' + queryString)
		let resultsIterator = await stub.getQueryResult(queryString);
		let method = thisClass['getAllResults'];
		
		let results = await method(resultsIterator, false);
		
		//return Buffer.from(JSON.stringify(results));
		return results;
	}
	
	async queryAssetsByOwner(stub, args, thisClass) {
		//   0
		// 'bob'
		if (args.length < 1) {
			throw new Error('Incorrect number of arguments. Expecting owner name.')
		}
		
		let owner = args[0].toLowerCase();
		let queryString = {};
		queryString.selector = {};
		queryString.selector.doctype = 'asset';
		queryString.selector.owner = owner;
		let method = thisClass['getQueryResultForQueryString'];
		let queryResults = await method(stub, JSON.stringify(queryString), thisClass);
		return queryResults; //shim.success(queryResults);
	}
	
	async queryAll(stub, args, thisClass) {
		//   0
		// 'queryString'
		if (args.length < 1) {
			throw new Error('Incorrect number of arguments. Expecting queryString');
		}
		let queryString = args[0];
		if (!queryString) {
			throw new Error('queryString must not be empty');
		}
		let method = thisClass['getQueryResultForQueryString'];
		let queryResults = await method(stub, queryString, thisClass);
		return Buffer.from(JSON.stringify(queryResults));
	}

	async hasAsset(stub, entity, thisClass) {
		let queryStringA = {};
		queryStringA.selector = {};
		queryStringA.selector.doctype = "asset";
		queryStringA.selector.owner = {};
		queryStringA.selector.owner.$eq = entity;

		let method = thisClass['getQueryResultForQueryString'];
		let assets = await method(stub, JSON.stringify(queryStringA), thisClass);
		
		if(assets.length === 0){
			throw new Error("User has no assets to sell");
		}

		let queryStringC = {};
		queryStringC.selector = {};
		queryStringC.selector.doctype = "sellContract";
		queryStringC.selector.owner = {};
		queryStringC.selector.owner.$eq = entity;
		queryStringC.selector.fulfilled = {};
		queryStringC.selector.fulfilled.$eq = "0";

		let sellContracts = await method(stub, JSON.stringify(queryStringC), thisClass);

		if(assets.length <= sellContracts.length){
			throw new Error("User has insufficient assets to sell");
		}

		return;
	}
	
	async initContract(stub, args, thisClass) {
		if (args.length != 3) {
			throw new Error('Incorrect number of arguments.');
		}
		
		if(args[2].toLowerCase() == "buy"){
			await thisClass.putBuy(stub, args, thisClass);
		} else if (args[2].toLowerCase() == "sell") {
			await thisClass.putSell(stub, args, thisClass);
		} else {
			throw new Error("Invalid contract type");
		}

		// let id = args[0];
		// let owner = args[1].toLowerCase();
		// let type = args[2].toLowerCase();
		
		// if(type === "sell"){
		// 	await thisClass.hasAsset(stub, owner, thisClass);
		// }

		// let assetState = await stub.getState(id);
		// if (assetState.toString()){
		// 	throw new error("Failed to add contract, ID already exists");
		// }
		
		// let contract = {};
		// contract.doctype = "contract";
		// contract.type = type;
		// contract.owner = owner;
		// contract.id = id;
		// contract.fulfilled = "0";
		// contract.matchedWith = "-1";
		
		// await stub.putState(id, Buffer.from(JSON.stringify(contract)));
		
		// await thisClass.checkAndMatch(stub, contract, thisClass);
		
		// console.info('Finish init contract');
	}

	async putSell(stub, args, thisClass){
		
		let id = args[0];
		let owner = args[1].toLowerCase();

		await thisClass.hasAsset(stub, owner, thisClass);

		let assetState = await stub.getState(id);
		if (assetState.toString()){
			throw new error("Failed to add contract, ID already exists");
		}

		let contract = {};
		contract.doctype = "sellContract";
		contract.owner = owner;
		contract.id = id;
		contract.fulfilled = "0";
		contract.matchedWith = "-1";

		await stub.putState(id, Buffer.from(JSON.stringify(contract)));
		
		await thisClass.checkAndMatch(stub, contract, thisClass);
		
		console.info('Finish init contract');

		return 0;
	}

	async putBuy(stub, args, thisClass){
		let id = args[0];
		let owner = args[1].toLowerCase();

		let assetState = await stub.getState(id);
		if (assetState.toString()){
			throw new error("Failed to add contract, ID already exists");
		}

		let contract = {};
		contract.doctype = "buyContract";
		contract.owner = owner;
		contract.id = id;
		contract.fulfilled = "0";
		contract.matchedWith = "-1";

		await stub.putState(id, Buffer.from(JSON.stringify(contract)));
		
		await thisClass.checkAndMatch(stub, contract, thisClass);
		
		console.info('Finish init contract');

		return 0;
	}

	async initContractInternal(stub, args, thisClass) {
		if (args.length != 2) {
			throw new Error('Incorrect number of arguments.');
		}
		
		let id = args[0];
		let owner = args[1].toLowerCase();
		
		let assetState = await stub.getState(id);
		if (assetState.toString()){
			throw new error("Failed to add contract, ID already exists");
		}
		
		let contract = {};
		contract.doctype = "sellContract";
		contract.owner = owner;
		contract.id = id;
		contract.fulfilled = "0";
		contract.matchedWith = "-1";
		
		await stub.putState(id, Buffer.from(JSON.stringify(contract)));
		
		await thisClass.checkAndMatch(stub, contract, thisClass);
		
		console.info('Finish init contract');
		
		return 1;
	}
	
	async getContractsByOwner(stub, args, thisClass) {
		//   0
		// 'bob'
		if (args.length < 1) {
			throw new Error('Incorrect number of arguments. Expecting owner name.');
		}
		
		let owner = args[0].toLowerCase();
		let queryString = {};
		queryString.selector = {};
		queryString.selector.doctype = {};
		queryString.selector.doctype.$ne = "asset";
		queryString.selector.owner = owner;
		let method = thisClass['getQueryResultForQueryString'];
		let queryResults = await method(stub, JSON.stringify(queryString), thisClass);
		return queryResults; //shim.success(queryResults);
	}
	
	async checkAndMatch(stub, contract, thisClass) {
		
		let queryString = {};
		queryString.selector = {};
		queryString.selector.owner = {};
		queryString.selector.owner.$ne = contract.owner;
		queryString.selector.fulfilled = {};
		queryString.selector.fulfilled.$eq = "0";
		let newIsBuy = 0;
		
		if (contract.doctype == "buyContract"){
			newIsBuy = 1;
			queryString.selector.doctype = "sellContract";
		} else {
			queryString.selector.doctype = "buyContract";
		}
		let method = thisClass['getQueryResultForQueryString'];
		let queryResults = await method(stub, JSON.stringify(queryString), thisClass);
		
		if(queryResults.length === 0){
			return;
		}
		
		let matchedID = queryResults[0].Record.id;
		
		let contractAsBytes = await stub.getState(matchedID); 
		
		let contractToFulfill = {};
		contractToFulfill = JSON.parse(contractAsBytes.toString()); //unmarshal

		console.info(contractToFulfill);
		contractToFulfill.fulfilled = "1";
		contractToFulfill.matchedWith = contract.id;
		
		let contractJSONasBytes = Buffer.from(JSON.stringify(contractToFulfill));
		
		await stub.putState(matchedID, contractJSONasBytes);
		
		contract.fulfilled = "1";
		contract.matchedWith = matchedID;

		let newContractJSONasBytes = Buffer.from(JSON.stringify(contract));
		await stub.putState(contract.id, newContractJSONasBytes);
		if(newIsBuy){
			await thisClass.facilitateTransfer(stub, contractToFulfill.owner, contract.owner, thisClass);
		} else {
			await thisClass.facilitateTransfer(stub, contract.owner, contractToFulfill.owner, thisClass);
		}
		console.info("Matched contract")
		return 1;
	}
	
	async facilitateTransfer(stub, from, to, thisClass){
		let queryString = {};
		queryString.selector = {};
		queryString.selector.doctype = "asset";
		queryString.selector.owner = {};
		queryString.selector.owner.$eq = from;

		let method = thisClass['getQueryResultForQueryString'];
		let queryResults = await method(stub, JSON.stringify(queryString), thisClass);
		
		if(queryResults.length === 0){
			throw new Error("No asset to transfer");
		}

		let asset = queryResults[0].Record;

		asset.owner = to;

		let transferredAsset = Buffer.from(JSON.stringify(asset));
		await stub.putState(asset.id, transferredAsset);

		return 0;
	}

};

shim.start(new Chaincode());