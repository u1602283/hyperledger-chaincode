/*
# PREAMBLE
# Based on code marbles_chaincode.js produced by IBM Corp. (Copyright IBM Corp. All Rights Reserved.)
# SPDX-License-Identifier: Apache-2.
# Guidance on basic structures such as retrieving from the state database was built upon, adding new ways of interacting with the state database.
# All work beyond the file /chaincode/chaincode_example02/node/chaincode_example02.js in release 1.4.0 of the 'fabric-samples' repository at:
# https://github.com/hyperledger/fabric-samples
# was produced by Scott Pickering and is also licensed under the Apache-2.0 license included with the code.
# 
# IBM was incredibly helpful here in getting started, would've been lovely for an email back during the project!
#
# This file is JSDoc compliant
*/

'use strict';
const shim = require('fabric-shim'); //Used for interaction with the Fabric system
const util = require('util'); //Useful features for Node
const crypto = require('crypto'); //Library for hashing among other cryptography-related functions


/**
 * This class contains all of the chaincode that is installed on the peers
 */
let Chaincode = class {

	/**
	 * This function simply intialises the chaincode
	 * @param {ChaincodeStub} stub provides all of the information required by the chaincode to execute
	 */
	async Init(stub) {
		let ret = stub.getFunctionAndParameters();
		console.info(ret);
		console.info('=========== Simple Asset Chaincode ==========='); //These don't actually print anything out during execution
		return shim.success();
	}
	
	/**
	 * Handler function for all chaincode invocations manages calling all of the original functions
	 * @param {ChaincodeStub} stub 
	 */
	async Invoke(stub) {
		console.info('Transaction ID: ' + stub.getTxID());
		console.info(util.format('Args: %j', stub.getArgs()));
		
		let ret = stub.getFunctionAndParameters(); //Extract all provided arguments including the function name
		console.info(ret);
		
		let method = this[ret.fcn]; //Check to see if the method called exists...
		if (!method) { //And fail if it doesn't
			console.log('no function of name:' + ret.fcn + ' found');
			throw new Error('Received unknown function ' + ret.fcn + ' invocation');
		}
		//Attempt to call the method and catch any failures, reporting the reason
		try {
			//All async methods must use the await keyword so they don't complete asynchronously
			let payload = await method(stub, ret.params, this);
			return shim.success(payload);
		} catch (err) {
			console.log(err);
			return shim.error(err);
		}
	}
	
	/**
	 * Initialise a wallet for a user
	 * @param {ChaincodeStub} stub 
	 * @param {Array} args 
	 * @param {Chaincode} thisClass allows function calls
	 */
	async initWallet(stub, args, thisClass) {
		//Sanity check, expecting an owner name and an initial balance
		if (args.length != 2) {
			throw new Error('Incorrect number of arguments. Expecting 2.');
		}

		let owner = args[0].toLowerCase();
		let balance = parseInt(args[1]);

		//Santiy check to ensure another wallet of the same name does not already exist
		let walletState = await stub.getState(owner);
		if (walletState.toString()){
			throw new Error("Failed to add wallet, ID already exists. Choose a different name.");
		}

		//Creation of the wallet JSON object
		let wallet = {};
		wallet.doctype = "wallet";
		wallet.owner = owner;
		wallet.balance = balance;

		//Add to the state database
		await stub.putState(owner, Buffer.from(JSON.stringify(wallet)));

		console.info('Finish init wallet');
	}
	
	/**
	 * Add a new asset to the state database
	 * @param {ChaincodeStub} stub 
	 * @param {Array} args 
	 * @param {Chaincode} thisClass 
	 */
	async initAsset(stub, args, thisClass) {
		//Expecting an asset ID, and owner, and a value
		if (args.length != 3) {
			throw new Error('Incorrect number of arguments. Expecting 4.');
		}
		//Make sure a user has a wallet before adding assets, like a rudimentary membership service
		await thisClass.checkHasWallet(stub, args[1].toLowerCase(), thisClass);

		let id = args[0];
		let owner = args[1].toLowerCase();
		let price = args[2];
		
		//Check to ensure asset ID does not already exist
		let assetState = await stub.getState(id);
		if (assetState.toString()){
			throw new Error("Failed to add asset, ID already exists.");
		}
		
		//Create the asset JSON object
		let asset = {};
		asset.doctype = 'asset';
		asset.id = id;
		asset.owner = owner;
		//Must use the timestamp here instead of calling the current Unix time. If this was done, each node would call the current Unix time at slightly differing times
		//so they would not be able to reach a consensus. The timestamp is still based on Unix time but it is universal as it is decided at the time of transaction creation.
		//Time created is self-explanatory
		asset.timeCreated = stub.getTxTimestamp();
		//Timestamp is updated on state change for tracking purposes
		asset.timestamp = stub.getTxTimestamp();
		asset.price = parseInt(price);
		//Could be used to track shipping progress
		asset.state = "initialised"
		
		//Add to the state database
		await stub.putState(id, Buffer.from(JSON.stringify(asset)));
		
		//Create a contract to sell the asset automatically
		//The ID is created as the hash of the asset ID
		await thisClass.initContractInternal(stub, [crypto.createHash('sha1').update(id).digest('hex'), owner, parseInt(price), id], thisClass);
		
		console.info('Finish init asset');
	}

	/**
	 * Update the recorded state of an asset
	 * @param {ChaincodeStub} stub 
	 * @param {Array} args 
	 * @param {Chaincode} thisClass 
	 */
	async updateAssetState(stub, args, thisClass) {
		//Expecting an asset ID and the new state
		if(args.length != 2) {
			throw new Error('Incorrect number of arguments.');
		}

		let id = args[0];
		let newState = args[1];

		//Must not be blank
		if(!newState){
			throw new Error('Invalid state.');
		}

		//Construct a query to retrieve the original asset
		let queryString = {};
		queryString.selector = {};
		queryString.selector.doctype = "asset";
		queryString.selector.id = id;

		//Acquire the asset from the state database
		let method = thisClass['getQueryResultForQueryString']; 
		let queryResults = await method(stub, JSON.stringify(queryString), thisClass);

		//Check to see if it was found
		if(queryResults.length === 0) {
			throw new Error("Asset does not exist.");
		}

		//Extract the record from the result
		let asset = queryResults[0].Record;

		//Update the state as well as the timestamp
		asset.state = newState;
		asset.timestamp = stub.getTxTimestamp();

		//Add back to the state database
		let adjustedAsset = Buffer.from(JSON.stringify(asset));

		await stub.putState(id, adjustedAsset);
	}
	
	/**
	 * Get any item by ID from the database; mostly used in debugging
	 * @param {ChaincodeStub} stub 
	 * @param {Array} args 
	 * @param {Chaincode} thisClass 
	 */
	async readItem(stub, args, thisClass) {
		//Expecting an object ID
		if (args.length != 1) {
			throw new Error('Incorrect number of arguments. Expecting ID of the item to query.');
		}
		
		let id = args[0];
		//Ensure something was provided
		if (!id) {
			throw new Error('ID must not be empty');
		}
		//Read the bytes of the object
		let assetAsbytes = await stub.getState(id); //get the marble from chaincode state
		//Return it as a string IFF it is found
		if (!assetAsbytes.toString()) {
			let jsonResp = {};
			jsonResp.Error = 'Asset does not exist: ' + id;
			throw new Error(JSON.stringify(jsonResp));
		}
		console.info('=======================================');
		console.log(assetAsbytes.toString());
		console.info('=======================================');
		return assetAsbytes;
	}
	
	/**
	 * Change the ownership of an asset. In a more developed version, this should only be called internally.
	 * @param {ChaincodeStub} stub 
	 * @param {Array} args 
	 * @param {Chaincode} thisClass 
	 */
	async transferAsset(stub, args, thisClass) {
		//Expectingan asset ID and a new owner.
		if (args.length < 2) {
			throw new Error('Incorrect number of arguments. Expecting asset ID and owner')
		}
		
		let id = args[0];
		let newOwner = args[1].toLowerCase();
		console.info('- start transferAsset ', id, newOwner);
		
		//Fetch the asset to transfer, ensure it exists
		let assetAsBytes = await stub.getState(id);
		if (!assetAsBytes || !assetAsBytes.toString()) {
			throw new Error('asset does not exist');
		}
		//Attempt to decode the JSON result
		let assetToTransfer = {};
		try {
			assetToTransfer = JSON.parse(assetAsBytes.toString()); //unmarshal
		} catch (err) {
			let jsonResp = {};
			jsonResp.error = 'Failed to decode JSON of: ' + id;
			throw new Error(jsonResp);
		}
		console.info(assetToTransfer);

		//Change the owner
		assetToTransfer.owner = newOwner; 
		
		//Rewrite the asset to the state database
		let assetJSONasBytes = Buffer.from(JSON.stringify(assetToTransfer));
		await stub.putState(id, assetJSONasBytes); 
		
		console.info('- end transferAsset (success)');
	}
	
	/**
	 * Used to iterate over a set of results, returning one big JSON string of results.
	 * This function was entirely used from the original file.
	 * @param {Iterator} iterator 
	 * @param {boolean} isHistory unused but would be for acquiring the history of a key's value
	 */
	async getAllResults(iterator, isHistory) {
		let allResults = [];
		while (true) {
			//Get the next result
			let res = await iterator.next();
			//Ensure it has a value
			if (res.value && res.value.value.toString()) {
				let jsonRes = {};
				console.log(res.value.value.toString('utf8'));
				
				//If we want the history for a key...
				if (isHistory && isHistory === true) {
					//...Also get the transaction ID, timestamp, and whether or not the object has been deleted
					jsonRes.TxId = res.value.tx_id;
					jsonRes.Timestamp = res.value.timestamp;
					jsonRes.IsDelete = res.value.is_delete.toString();
					//Attempt to decode the result
					try {
						jsonRes.Value = JSON.parse(res.value.value.toString('utf8'));
					} catch (err) {
						console.log(err);
						jsonRes.Value = res.value.value.toString('utf8');
					}
				} else { //Get the value on its own
					jsonRes.Key = res.value.key;
					//Attempt to decode the result
					try {
						jsonRes.Record = JSON.parse(res.value.value.toString('utf8'));
					} catch (err) {
						console.log(err);
						jsonRes.Record = res.value.value.toString('utf8');
					}
				}
				//Add the result to the return value
				allResults.push(jsonRes);
			}
			//If we've gone through every item in the iterator, return the results
			if (res.done) {
				console.log('end of data');
				await iterator.close();
				console.info(allResults);
				return allResults;
			}
		}
	}
	
	/**
	 * Queries the state database on a query string. Fairly low level, so only used for internal use and debugging.
	 * @param {ChaincodeStub} stub 
	 * @param {String} queryString 
	 * @param {Chaincode} thisClass 
	 */
	async getQueryResultForQueryString(stub, queryString, thisClass) {
		
		console.info('- getQueryResultForQueryString queryString:\n' + queryString)
		//Make the query
		let resultsIterator = await stub.getQueryResult(queryString);
		let method = thisClass['getAllResults'];
		//Get a return value
		let results = await method(resultsIterator, false);
		

		return results;
	}
	
	/**
	 * Get all assets for a particular owner.
	 * @param {ChaincodeStub} stub 
	 * @param {Array} args 
	 * @param {Chaincode} thisClass 
	 */
	async queryAssetsByOwner(stub, args, thisClass) {
		//Expecting an owner only
		if (args.length < 1) {
			throw new Error('Incorrect number of arguments. Expecting owner name.')
		}
		
		let owner = args[0].toLowerCase();
		//Build the query string
		let queryString = {};
		queryString.selector = {};
		queryString.selector.doctype = 'asset';
		queryString.selector.owner = owner;
		let method = thisClass['getQueryResultForQueryString'];
		//Make the query
		let queryResults = await method(stub, JSON.stringify(queryString), thisClass);
		return queryResults; 
	}
	
	/**
	 * Used to call the method getQueryResultForQueryString externally, mostly for debugging.
	 * @param {ChaincodeStub} stub 
	 * @param {Array} args 
	 * @param {Chaincode} thisClass 
	 */
	async queryAll(stub, args, thisClass) {
		//Expecting only a raw query string
		if (args.length < 1) {
			throw new Error('Incorrect number of arguments. Expecting queryString');
		}
		let queryString = args[0];
		//Ensure it was provided
		if (!queryString) {
			throw new Error('queryString must not be empty');
		}
		//Make the query and return the results
		let method = thisClass['getQueryResultForQueryString'];
		let queryResults = await method(stub, queryString, thisClass);
		return Buffer.from(JSON.stringify(queryResults));
	}

	/**
	 * Check to see if a user owns a particular asset and can sell it
	 * @param {ChaincodeStub} stub 
	 * @param {String} entity User to check owns the asset
	 * @param {String} assetID Asset ID to check the safety of sale
	 * @param {Chaincode} thisClass 
	 */
	async hasAsset(stub, entity, assetID, thisClass) {
		//Build the query string that checks that a user owns the asset. A is for asset
		let queryStringA = {};
		queryStringA.selector = {};
		queryStringA.selector.doctype = "asset";
		queryStringA.selector.owner = entity;
		queryStringA.selector.id = assetID;
		//Make the query
		let method = thisClass['getQueryResultForQueryString'];
		let assets = await method(stub, JSON.stringify(queryStringA), thisClass);
		//Fail if the asset cannot be found in the given name
		if(assets.length === 0){
			throw new Error("User has no assets to sell or does not own this asset");
		}
		//Ensure a user is not already trying to sell this asset. C is for contract
		let queryStringC = {};
		queryStringC.selector = {};
		queryStringC.selector.doctype = "sellContract";
		queryStringC.selector.owner = entity;
		queryStringC.selector.fulfilled = "0";
		queryStringC.selector.assetID = assetID;
		//Perform the query
		let sellContracts = await method(stub, JSON.stringify(queryStringC), thisClass);
		//There should be no results
		if(sellContracts.length !== 0){
			throw new Error("User already has a sell contract for this asset.");
		}
		//Allow otherwise
		return;
	}

	/**
	 * Basic am=embership check to see if a user has a wallet
	 * @param {ChaincodeStub} stub 
	 * @param {String} owner 
	 * @param {Chaincode} thisClass 
	 */
	async checkHasWallet(stub, owner, thisClass) {
		//Build the query string
		let queryString = {};
		queryString.selector = {};
		queryString.selector.doctype = "wallet";
		queryString.selector.owner = owner;
		//Perform the query
		let method = thisClass['getQueryResultForQueryString'];
		let queryResults = await method(stub, JSON.stringify(queryString), thisClass);
		//Length SHOULD be one, left as this so I don't break anything for now.
		if(queryResults.length === 0) {
			throw new Error("User does not have a wallet, initialise a wallet before any contracts or assets");
		}

		return 0;
	}
	
	/**
	 * Create a contract in the state database, either buy or sell
	 * @param {ChaincodeStub} stub 
	 * @param {Array} args 
	 * @param {Chaincode} thisClass 
	 */
	async initContract(stub, args, thisClass) {
		//Ensure the user has a wallet
		await thisClass.checkHasWallet(stub, args[1].toLowerCase(), thisClass);
		//Direct to the appropriate function depending on the contract type.
		if(args[2].toLowerCase() == "buy"){
			await thisClass.putBuy(stub, args, thisClass);
		} else if (args[2].toLowerCase() == "sell") {
			await thisClass.putSell(stub, args, thisClass);
		} else {
			throw new Error("Invalid contract type");
		}
	}

	/**
	 * Create a sell contract for an asset
	 * @param {ChaincodeStub} stub 
	 * @param {Array} args 
	 * @param {Chaincode} thisClass 
	 */
	async putSell(stub, args, thisClass){
		//Expecting a contract ID, the owner of the contract, the contract type, the sale price, and the asset ID being sold
		if (args.length != 5) {
			throw new Error('Incorrect number of arguments for a sell contract.');
		}

		let id = args[0];
		let owner = args[1].toLowerCase();
		let price = args[3];
		let assetID = args[4];

		//Ensure the user owns the asset and it is not already being sold
		await thisClass.hasAsset(stub, owner, assetID, thisClass);
		//Ensure a contract of the same ID does not already exist
		let assetState = await stub.getState(id);
		if (assetState.toString()){
			throw new Error("Failed to add contract, ID already exists");
		}
		//Build the JSON object
		let contract = {};
		contract.doctype = "sellContract";
		contract.owner = owner;
		contract.id = id;
		//Used for automatic matching
		contract.fulfilled = "0";
		//ID of the contract matched with, -1 is default for unmatched
		contract.matchedWith = "-1";
		contract.price = parseInt(price);
		contract.assetID = assetID;
		//Add the sell contract
		await stub.putState(id, Buffer.from(JSON.stringify(contract)));
		//Automatically attempt to match it with an existing buy contract
		await thisClass.checkAndMatch(stub, contract, thisClass);
		
		console.info('Finish init contract');

		return 0;
	}

	/**
	 * Create a sell contract for an asset
	 * @param {ChaincodeStub} stub 
	 * @param {Array} args 
	 * @param {Chaincode} thisClass 
	 */
	async putBuy(stub, args, thisClass){
		//Expecting a contract ID, the owner of the contract, the contract type, and the price willing to be paid
		if (args.length != 4) {
			throw new Error('Incorrect number of arguments for a buy contract.');
		}

		let id = args[0];
		let owner = args[1].toLowerCase();
		let price = args[3];
		//Query the wallet of the user, this allows us to check if they have sufficient balance to make a purchase at this price
		let queryString = {};
		queryString.selector = {};
		queryString.selector.doctype = "wallet";
		queryString.selector.owner = owner;

		//Get the wallet
		let method = thisClass['getQueryResultForQueryString'];
		let queryResults = await method(stub, JSON.stringify(queryString), thisClass);

		let wallet = queryResults[0].Record;
		//Balance check here
		//This does not account for existing buy contracts but could be later implemented
		if(wallet.balance < price) {
			throw new Error("Insufficient funds for this buy contract.");
		}
		//Ensure contract ID does not already exist
		let assetState = await stub.getState(id);
		if (assetState.toString()){
			throw new Error("Failed to add contract, ID already exists");
		}

		//Build the contract JSON object
		let contract = {};
		contract.doctype = "buyContract";
		contract.owner = owner;
		contract.id = id;
		//Used for automatic matching
		contract.fulfilled = "0";
		//ID of the contract matched with, -1 is default for unmatched
		contract.matchedWith = "-1";
		contract.price = parseInt(price);
		
		//Add the contract to the state database
		await stub.putState(id, Buffer.from(JSON.stringify(contract)));
		
		//Automatically attempt to match it with an existing sell contract
		await thisClass.checkAndMatch(stub, contract, thisClass);
		
		console.info('Finish init contract');

		return 0;
	}

	/**
	 * Function full the creation of automatic sell contracts, only to be called internally
	 * Skips asset ownership checks as this is only called once a user adds a new asset
	 * @param {ChaincodeStub} stub 
	 * @param {Array} args 
	 * @param {Chaincode} thisClass 
	 */
	async initContractInternal(stub, args, thisClass) {
		//Expecting a contract ID, the owner of the contract, the price willing to be paid, and the asset ID being sold. This will always be a sell contract
		if (args.length != 4) {
			throw new Error('Incorrect number of arguments.');
		}
		
		let id = args[0];
		let owner = args[1].toLowerCase();
		let price = args[2];
		let assetID = args[3];
		
		//Ensure contract ID doesn't already exist. It shouldnt because it's a SHA1 hash here.
		let assetState = await stub.getState(id);
		if (assetState.toString()){
			throw new Error("Failed to add contract, ID already exists");
		}
		
		let contract = {};
		contract.doctype = "sellContract";
		contract.owner = owner;
		contract.id = id;
		//Used for automatic matching
		contract.fulfilled = "0";
		//ID of the contract matched with, -1 is default for unmatched
		contract.matchedWith = "-1";
		contract.price = parseInt(price);
		contract.assetID = assetID;
		
		//Add the contract to the state database
		await stub.putState(id, Buffer.from(JSON.stringify(contract)));
		
		//Automatically try to match with an existing buy contract
		await thisClass.checkAndMatch(stub, contract, thisClass);
		
		console.info('Finish init contract');
		
		return 1;
	}
	
	/**
	 * Retrieve all contracts belonging to an entity
	 * @param {ChaincodeStub} stub 
	 * @param {Array} args 
	 * @param {Chaincode} thisClass 
	 */
	async getContractsByOwner(stub, args, thisClass) {
		//Expecting only an owner
		if (args.length < 1) {
			throw new Error('Incorrect number of arguments. Expecting owner name.');
		}
		
		let owner = args[0].toLowerCase();
		//Build query string
		let queryString = {};
		queryString.selector = {};
		queryString.selector.doctype = {};
		queryString.selector.doctype.$ne = "asset";
		queryString.selector.owner = owner;
		let method = thisClass['getQueryResultForQueryString'];
		//Make query and return results
		let queryResults = await method(stub, JSON.stringify(queryString), thisClass);
		return queryResults;
	}
	
	/**
	 * Function for the automation of matching buy and sell contracts, ensuring price conditions are met.
	 * The match is rudimentary, matching with the first possible contract, could be further developed, looking for lowest price etc.
	 * @param {ChaincodeStub} stub 
	 * @param {Object} contract easier to pass the entire contract we are attempting to find a match for
	 * @param {Chaincode} thisClass 
	 */
	async checkAndMatch(stub, contract, thisClass) {
		//Construct the query string to look for a viable match
		//A match should not belong to the owner of the contract we are trying to match
		//It should also be not already fulfilled
		let queryString = {};
		queryString.selector = {};
		queryString.selector.owner = {};
		queryString.selector.owner.$ne = contract.owner;
		queryString.selector.fulfilled = "0";
		queryString.selector.price = {};
		//Used below to find the appropriate type of contract
		let newIsBuy = 0;
		
		//If we are trying to find a match for a buy contract...
		if (contract.doctype == "buyContract"){
			newIsBuy = 1;
			//Make sure we look for a sell contract
			queryString.selector.doctype = "sellContract";
			//Where the price is less than or equal to the price we are willing to pay
			queryString.selector.price.$lte = contract.price;
		} else {
			//Otherwise find a buy contract
			queryString.selector.doctype = "buyContract";
			//Where the price is greater than or equal to the amount we are trying to sell for
			queryString.selector.price.$gte = contract.price;
		}

		//Make the query
		let method = thisClass['getQueryResultForQueryString'];
		let queryResults = await method(stub, JSON.stringify(queryString), thisClass);
		//If there isn't a viable match, return
		if(queryResults.length === 0){
			return;
		}
		
		//get the ID of the viable match
		let matchedID = queryResults[0].Record.id;
		
		//Get that contract so the matching can be performed
		let contractAsBytes = await stub.getState(matchedID); 
		
		let contractToFulfill = {};
		contractToFulfill = JSON.parse(contractAsBytes.toString()); //unmarshal

		//Set the match as fulfilled and fill in the ID it was matched with
		console.info(contractToFulfill);
		contractToFulfill.fulfilled = "1";
		contractToFulfill.matchedWith = contract.id;
		
		//Write back to the state database
		let contractJSONasBytes = Buffer.from(JSON.stringify(contractToFulfill));
		
		await stub.putState(matchedID, contractJSONasBytes);

		//Set the new contract as fulfilled and fill in the ID it was matched with
		contract.fulfilled = "1";
		contract.matchedWith = matchedID;

		//Add in the new contract to the state database
		let newContractJSONasBytes = Buffer.from(JSON.stringify(contract));
		await stub.putState(contract.id, newContractJSONasBytes);
		//Call the appropriate function to facilitate asset ownership transfer function depending on which one is the buying and selling contract
		if(newIsBuy){
			await thisClass.facilitateTransfer(stub, contractToFulfill.owner, contract.owner, contractToFulfill.assetID, thisClass);
		} else {
			await thisClass.facilitateTransfer(stub, contract.owner, contractToFulfill.owner, contract.assetID, thisClass);
		}
		console.info("Matched contract")
		return 0;
	}
	
	/**
	 * Manage the transfer of asset ownership after a successful contract match, only supposed to be called internally.
	 * @param {ChaincodeStub} stub 
	 * @param {String} from previous owner
	 * @param {String} to new owner
	 * @param {String} assetID asset to be transferred
	 * @param {Chaincode} thisClass 
	 */
	async facilitateTransfer(stub, from, to, assetID, thisClass){
		//Make a check to ensure that the 'from' owns the asset they want to transfer
		let queryString = {};
		queryString.selector = {};
		queryString.selector.doctype = "asset";
		queryString.selector.owner = from;
		queryString.selector.id = assetID;

		//Perform the query
		let method = thisClass['getQueryResultForQueryString'];
		let queryResults = await method(stub, JSON.stringify(queryString), thisClass);
		
		//Fail if the asset cannot be found to belong to 'from'
		if(queryResults.length === 0){
			throw new Error("No asset to transfer or you do not own the asset that is being transferred.");
		}

		let asset = queryResults[0].Record;
		//Make the change
		asset.owner = to;
		//Rewrite the asset
		let transferredAsset = Buffer.from(JSON.stringify(asset));
		await stub.putState(asset.id, transferredAsset);
		//Automatically make the payment for the asset
		await thisClass.makePayment(stub, from, to, asset.price, thisClass);

		return 0;
	}

	/**
	 * Facilitate payment for an asset upon matching a contract
	 * @param {ChaincodeStub} stub 
	 * @param {String} seller 
	 * @param {String} buyer 
	 * @param {String} price 
	 * @param {Chaincode} thisClass 
	 */
	async makePayment(stub, seller, buyer, price, thisClass) {
		//Build query strings to retrieve the wallets of the buyer and seller
		let queryStringSeller = {};
		queryStringSeller.selector = {};
		queryStringSeller.selector.doctype = "wallet";
		queryStringSeller.selector.owner = seller;

		let queryStringBuyer = {};
		queryStringBuyer.selector = {};
		queryStringBuyer.selector.doctype = "wallet";
		queryStringBuyer.selector.owner = buyer;

		//Make the queries to get the wallets
		let method = thisClass['getQueryResultForQueryString']; //Must be performed like this to ensure owner is the one selling
		let queryResultsSeller = await method(stub, JSON.stringify(queryStringSeller), thisClass);
		let queryResultsBuyer = await method(stub, JSON.stringify(queryStringBuyer), thisClass);

		let walletSeller = queryResultsSeller[0].Record;
		let walletBuyer = queryResultsBuyer[0].Record;
		//Fail if the buyer has insufficient balance
		if(walletBuyer.balance < price) {
			throw new Error("Buyer has insufficient funds for transfer");
		}

		//Adjust the wallet balances
		walletSeller.balance = walletSeller.balance + price;
		walletBuyer.balance = walletBuyer.balance - price;

		//Recreate the JSON objects
		let adjustedSeller = Buffer.from(JSON.stringify(walletSeller));
		let adjustedBuyer = Buffer.from(JSON.stringify(walletBuyer));

		//Write back to the state database
		await stub.putState(walletSeller.owner, adjustedSeller);
		await stub.putState(walletBuyer.owner, adjustedBuyer);

		return 0;
	}

};

shim.start(new Chaincode()); //Create an instatiation of the chaincode to run