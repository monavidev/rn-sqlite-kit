import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * The native boundary intentionally transports bind parameters and result sets
 * as JSON strings. That keeps this Codegen contract primitive-only and stable
 * across supported React Native versions.
 */
export interface Spec extends TurboModule {
  open(databaseName: string): Promise<string>;
  close(connectionId: string): Promise<boolean>;
  deleteDatabase(databaseName: string): Promise<boolean>;
  execute(connectionId: string, sql: string, paramsJson: string): Promise<string>;
  executeBatch(connectionId: string, statementsJson: string): Promise<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('ReactNativeSqliteKit');
