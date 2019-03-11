/*
# Based on code marbles_chaincode.js produced by IBM Corp. (Copyright IBM Corp. All Rights Reserved.)
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
	
	
	async initWallet(stub, args, thisClass) {
		if (args.length != 2) {
			throw new Error('Incorrect number of arguments. Expecting 2.');
		}

		let owner = args[0].toLowerCase();
		let balance = parseInt(args[1]);

		let walletState = await stub.getState(owner);
		if (walletState.toString()){
			throw new Error("Failed to add wallet, ID already exists. Choose a different name.");
		}

		let wallet = {};
		wallet.doctype = "wallet";
		wallet.owner = owner;
		wallet.balance = balance;

		await stub.putState(owner, Buffer.from(JSON.stringify(wallet)));

		console.info('Finish init wallet');
	}
	
	async initAsset(stub, args, thisClass) {
		if (args.length != 4) {
			throw new Error('Incorrect number of arguments. Expecting 4.');
		}

		await thisClass.checkHasWallet(stub, args[1].toLowerCase(), thisClass);

		let id = args[0];
		let owner = args[1].toLowerCase();
		let timestamp = args[2];
		let price = args[3];
		
		let assetState = await stub.getState(id);
		if (assetState.toString()){
			throw new Error("Failed to add asset, ID already exists.");
		}
		
		let asset = {};
		asset.doctype = 'asset';
		asset.id = id;
		asset.owner = owner;
		asset.timestamp = timestamp;
		asset.price = parseInt(price);
		
		await stub.putState(id, Buffer.from(JSON.stringify(asset)));
		
		await thisClass.initContractInternal(stub, [crypto.createHash('sha1').update(id).digest('hex'), owner, parseInt(price), id], thisClass);
		
		console.info('Finish init asset');
	}
	
	async readItem(stub, args, thisClass) {
		if (args.length != 1) {
			throw new Error('Incorrect number of arguments. Expecting ID of the item to query.');
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

	async hasAsset(stub, entity, assetID, thisClass) {
		let queryStringA = {};
		queryStringA.selector = {};
		queryStringA.selector.doctype = "asset";
		queryStringA.selector.owner = entity;
		queryStringA.selector.id = assetID;

		let method = thisClass['getQueryResultForQueryString'];
		let assets = await method(stub, JSON.stringify(queryStringA), thisClass);
		
		if(assets.length === 0){
			throw new Error("User has no assets to sell or does not own this asset");
		}

		let queryStringC = {};
		queryStringC.selector = {};
		queryStringC.selector.doctype = "sellContract";
		queryStringC.selector.owner = entity;
		queryStringC.selector.fulfilled = "0";
		queryStringC.selector.assetID = assetID;

		let sellContracts = await method(stub, JSON.stringify(queryStringC), thisClass);

		if(sellContracts.length !== 0){
			throw new Error("User already has a sell contract for this asset.");
		}

		return;
	}

	async checkHasWallet(stub, owner, thisClass) {
		let queryString = {};
		queryString.selector = {};
		queryString.selector.doctype = "wallet";
		queryString.selector.owner = owner;

		let method = thisClass['getQueryResultForQueryString']; //Must be performed like this to ensure owner is the one selling
		let queryResults = await method(stub, JSON.stringify(queryString), thisClass);

		if(queryResults.length === 0) {
			throw new Error("User does not have a wallet, initialise a wallet before any contracts or assets");
		}

		return 0;
	}
	
	async initContract(stub, args, thisClass) {
		await thisClass.checkHasWallet(stub, args[1].toLowerCase(), thisClass);
		if(args[2].toLowerCase() == "buy"){
			await thisClass.putBuy(stub, args, thisClass);
		} else if (args[2].toLowerCase() == "sell") {
			await thisClass.putSell(stub, args, thisClass);
		} else {
			throw new Error("Invalid contract type");
		}
	}

	async putSell(stub, args, thisClass){
		if (args.length != 5) {
			throw new Error('Incorrect number of arguments for a sell contract.');
		}

		let id = args[0];
		let owner = args[1].toLowerCase();
		let price = args[3];
		let assetID = args[4];

		await thisClass.hasAsset(stub, owner, assetID, thisClass);

		let assetState = await stub.getState(id);
		if (assetState.toString()){
			throw new Error("Failed to add contract, ID already exists");
		}

		let contract = {};
		contract.doctype = "sellContract";
		contract.owner = owner;
		contract.id = id;
		contract.fulfilled = "0";
		contract.matchedWith = "-1";
		contract.price = parseInt(price);
		contract.assetID = assetID;

		await stub.putState(id, Buffer.from(JSON.stringify(contract)));
		
		await thisClass.checkAndMatch(stub, contract, thisClass);
		
		console.info('Finish init contract');

		return 0;
	}

	async putBuy(stub, args, thisClass){
		if (args.length != 4) {
			throw new Error('Incorrect number of arguments for a buy contract.');
		}

		let id = args[0];
		let owner = args[1].toLowerCase();
		let price = args[3];

		let queryString = {};
		queryString.selector = {};
		queryString.selector.doctype = "wallet";
		queryString.selector.owner = owner;

		let method = thisClass['getQueryResultForQueryString']; //Must be performed like this to ensure owner is the one selling
		let queryResults = await method(stub, JSON.stringify(queryString), thisClass);

		let wallet = queryResults[0].Record;

		if(wallet.balance < price) {
			throw new Error("Insufficient funds for this buy contract.");
		}

		let assetState = await stub.getState(id);
		if (assetState.toString()){
			throw new Error("Failed to add contract, ID already exists");
		}

		let contract = {};
		contract.doctype = "buyContract";
		contract.owner = owner;
		contract.id = id;
		contract.fulfilled = "0";
		contract.matchedWith = "-1";
		contract.price = parseInt(price);

		await stub.putState(id, Buffer.from(JSON.stringify(contract)));
		
		await thisClass.checkAndMatch(stub, contract, thisClass);
		
		console.info('Finish init contract');

		return 0;
	}

	async initContractInternal(stub, args, thisClass) {
		if (args.length != 4) {
			throw new Error('Incorrect number of arguments.');
		}
		
		let id = args[0];
		let owner = args[1].toLowerCase();
		let price = args[2];
		let assetID = args[3];
		
		let assetState = await stub.getState(id);
		if (assetState.toString()){
			throw new Error("Failed to add contract, ID already exists");
		}
		
		let contract = {};
		contract.doctype = "sellContract";
		contract.owner = owner;
		contract.id = id;
		contract.fulfilled = "0";
		contract.matchedWith = "-1";
		contract.price = parseInt(price);
		contract.assetID = assetID;
		
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
		queryString.selector.fulfilled = "0";
		queryString.selector.price = {};
		let newIsBuy = 0;
		
		if (contract.doctype == "buyContract"){
			newIsBuy = 1;
			queryString.selector.doctype = "sellContract";
			queryString.selector.price.$lte = contract.price;
		} else {
			queryString.selector.doctype = "buyContract";
			queryString.selector.price.$gte = contract.price;
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
			await thisClass.facilitateTransfer(stub, contractToFulfill.owner, contract.owner, contractToFulfill.assetID, thisClass);
		} else {
			await thisClass.facilitateTransfer(stub, contract.owner, contractToFulfill.owner, contract.assetID, thisClass);
		}
		console.info("Matched contract")
		return 1;
	}
	
	async facilitateTransfer(stub, from, to, assetID, thisClass){
		let queryString = {};
		queryString.selector = {};
		queryString.selector.doctype = "asset";
		queryString.selector.owner = from;
		queryString.selector.id = assetID;

		let method = thisClass['getQueryResultForQueryString']; //Must be performed like this to ensure owner is the one selling
		let queryResults = await method(stub, JSON.stringify(queryString), thisClass);
		
		if(queryResults.length === 0){
			throw new Error("No asset to transfer or you do not own the asset that is being transferred.");
		}

		let asset = queryResults[0].Record;

		asset.owner = to;

		let transferredAsset = Buffer.from(JSON.stringify(asset));
		await stub.putState(asset.id, transferredAsset);
		await thisClass.makePayment(stub, from, to, asset.price, thisClass);

		return 0;
	}

	async makePayment(stub, seller, buyer, price, thisClass) {
		let queryStringSeller = {};
		queryStringSeller.selector = {};
		queryStringSeller.selector.doctype = "wallet";
		queryStringSeller.selector.owner = seller;

		let queryStringBuyer = {};
		queryStringBuyer.selector = {};
		queryStringBuyer.selector.doctype = "wallet";
		queryStringBuyer.selector.owner = buyer;

		let method = thisClass['getQueryResultForQueryString']; //Must be performed like this to ensure owner is the one selling
		let queryResultsSeller = await method(stub, JSON.stringify(queryStringSeller), thisClass);
		let queryResultsBuyer = await method(stub, JSON.stringify(queryStringBuyer), thisClass);

		let walletSeller = queryResultsSeller[0].Record;
		let walletBuyer = queryResultsBuyer[0].Record;

		if(walletBuyer.balance < price) {
			throw new Error("Buyer has insufficient funds for transfer");
		}
		
		walletSeller.balance = walletSeller.balance + price;
		walletBuyer.balance = walletBuyer.balance - price;

		let adjustedSeller = Buffer.from(JSON.stringify(walletSeller));
		let adjustedBuyer = Buffer.from(JSON.stringify(walletBuyer));

		await stub.putState(walletSeller.owner, adjustedSeller);
		await stub.putState(walletBuyer.owner, adjustedBuyer);

		return 0;
	}

};

shim.start(new Chaincode());