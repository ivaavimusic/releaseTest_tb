/**
 * Market Making Command Parser Service
 * Parses mmbot command arguments
 */

import { ArgumentParser, WalletParser } from '../../parsing/index.js';
import { tradingWallets } from '../../wallets.js';

/**
 * MMCommandParser - Parses market making bot commands
 */
export class MMCommandParser {
  /**
   * Parse mmbot command format
   * @param {Array} args - Command arguments
   * @returns {Object} Parsed configuration
   */
  static parseCommand(args) {
    console.log('🔍 Parsing mmbot command format...');
    
    // Step 1: Parse wallet selection and gas
    const { selectedWallets, remainingArgs: afterWallets } = WalletParser.parse(args, tradingWallets);
    const { customGasPrice, remainingArgs: afterGas } = ArgumentParser.parseGasPrice(afterWallets);
    
    // Step 2: Extract token (first argument)
    if (afterGas.length < 1) {
      throw new Error('Token symbol must be specified');
    }
    
    const token = afterGas[0];
    let finalArgs = afterGas.slice(1);
    
    // Step 3: Check for CHASE mode
    const chaseIndex = finalArgs.findIndex(arg => arg.toUpperCase() === 'CHASE');
    const chaseMode = chaseIndex !== -1;
    if (chaseMode) {
      finalArgs = finalArgs.filter((_, index) => index !== chaseIndex);
      console.log('🎯 CHASE mode enabled: base price will reset at every interval');
    }
    
    // Step 4: Parse intervals and loops
    const { loops, remainingArgs: afterLoops } = ArgumentParser.parseLoops(finalArgs, 'mmbot');
    
    // Parse I-X format
    let checkInterval = 6; // Default 6 seconds (I-0.1)
    let intervalArgs = [...afterLoops];
    const intervalIndex = intervalArgs.findIndex(arg => arg.startsWith('I-') || arg.startsWith('i-'));
    if (intervalIndex !== -1) {
      const intervalStr = intervalArgs[intervalIndex];
      const intervalValue = intervalStr.substring(2);
      const intervalMinutes = parseFloat(intervalValue);
      
      if (isNaN(intervalMinutes) || intervalMinutes <= 0 || intervalMinutes > 60) {
        throw new Error('Invalid interval! Must be between 0.1 and 60 minutes (use I-X format)');
      }
      
      checkInterval = Math.round(intervalMinutes * 60);
      intervalArgs = intervalArgs.filter((_, index) => index !== intervalIndex);
      console.log(`✅ Using I-X format: ${intervalMinutes} minute(s) = ${checkInterval}s`);
    }
    
    // Step 5: Parse amounts and ranges from remaining args
    const paramArgs = intervalArgs;
    
    if (paramArgs.length < 4) {
      throw new Error('Must specify: V-amount T-amount RL-range RH-range');
    }
    
    // Parse V-amount (VIRTUAL)
    const vAmountStr = paramArgs[0];
    if (!vAmountStr.startsWith('V-') && !vAmountStr.startsWith('v-')) {
      throw new Error('First amount must be V-X format (VIRTUAL amount)');
    }
    const virtualAmount = vAmountStr.substring(2);
    
    // Parse T-amount (TOKEN)
    const tAmountStr = paramArgs[1];
    if (!tAmountStr.startsWith('T-') && !tAmountStr.startsWith('t-')) {
      throw new Error('Second amount must be T-X format (TOKEN amount)');
    }
    const tokenAmount = tAmountStr.substring(2);
    
    // Parse RL-range (Lower range - buy threshold)
    const rlRangeStr = paramArgs[2];
    if (!rlRangeStr.startsWith('RL-') && !rlRangeStr.startsWith('rl-')) {
      throw new Error('Third parameter must be RL-X% format (lower range for buying)');
    }
    const lowerRangeValue = rlRangeStr.substring(3);
    const lowerRange = parseFloat(lowerRangeValue.replace('%', ''));
    
    if (isNaN(lowerRange) || lowerRange <= 0 || lowerRange > 50) {
      throw new Error('Invalid RL range! Must be between 0% and 50%');
    }
    
    // Parse RH-range (Higher range - sell threshold)
    const rhRangeStr = paramArgs[3];
    if (!rhRangeStr.startsWith('RH-') && !rhRangeStr.startsWith('rh-')) {
      throw new Error('Fourth parameter must be RH-X% format (higher range for selling)');
    }
    const higherRangeValue = rhRangeStr.substring(3);
    const higherRange = parseFloat(higherRangeValue.replace('%', ''));
    
    if (isNaN(higherRange) || higherRange <= 0 || higherRange > 50) {
      throw new Error('Invalid RH range! Must be between 0% and 50%');
    }
    
    // Normalize loops: use null to represent INFINITE for downstream logic
    const normalizedLoops = (loops === Infinity ? null : loops);

    console.log(`📋 Parsed configuration:`);
    console.log(`   🪙 Token: ${token}`);
    console.log(`   👛 Wallets: ${selectedWallets.length}`);
    console.log(`   💰 VIRTUAL Amount: ${virtualAmount}`);
    console.log(`   🎯 TOKEN Amount: ${tokenAmount}`);
    console.log(`   📉 Lower Range (RL): ${lowerRange}% (buy threshold)`);
    console.log(`   📈 Higher Range (RH): ${higherRange}% (sell threshold)`);
    console.log(`   ⏰ Interval: ${checkInterval}s`);
    console.log(`   🔄 Loops: ${normalizedLoops ?? 'INFINITE'}`);
    console.log(`   🎯 Chase Mode: ${chaseMode ? 'ON' : 'OFF'}`);
    console.log(`   ⛽ Gas: ${customGasPrice || '0.02'} gwei`);
    
    return {
      selectedWallets,
      token,
      virtualAmount,
      tokenAmount,
      lowerRange,
      higherRange,
      checkInterval,
      loops: normalizedLoops, // null means infinite
      chaseMode,
      customGasPrice
    };
  }
  
  /**
   * Display usage help
   */
  static showUsage() {
    console.log('📊 MMBOT - SINGLE TOKEN MARKET MAKING');
    console.log('=====================================');
    console.log('');
    console.log('📋 FORMAT:');
    console.log('  mmbot [wallets] <token> <V-amount> <T-amount> <RL-range> <RH-range> [I-interval] [L-loops] [CHASE] [gas]');
    console.log('');
    console.log('👛 WALLET SELECTION:');
    console.log('  • B1 B3 B5 - Use specific wallets');
    console.log('  • (empty) - Use all wallets');
    console.log('');
    console.log('🪙 TOKEN:');
    console.log('  • Ticker: TRUST, VADER');
    console.log('  • Contract: 0x1234...abcd');
    console.log('');
    console.log('💰 AMOUNTS:');
    console.log('  • V-100 - Buy with 100 VIRTUAL');
    console.log('  • V-1% - Buy with 1% of balance');
    console.log('  • T-50 - Sell 50 tokens');
    console.log('  • T-2% - Sell 2% of token balance');
    console.log('');
    console.log('📊 RANGES:');
    console.log('  • RL-3% - Buy when price drops 3%');
    console.log('  • RH-3% - Sell when price rises 3%');
    console.log('');
    console.log('⏰ INTERVAL:');
    console.log('  • I-1 - Check every 1 minute');
    console.log('  • I-0.5 - Check every 30 seconds');
    console.log('');
    console.log('🔄 LOOPS:');
    console.log('  • L-5 - Execute 5 loops');
    console.log('  • (empty) - Run indefinitely');
    console.log('');
    console.log('🎯 CHASE MODE:');
    console.log('  • CHASE - Update base price dynamically');
    console.log('');
    console.log('📝 EXAMPLES:');
    console.log('  mmbot TRUST V-1% T-2% RL-3% RH-3% I-0.5 L-2');
    console.log('  mmbot B1 B3 TRUST V-100 T-50% RL-2% RH-5% CHASE');
  }
} 