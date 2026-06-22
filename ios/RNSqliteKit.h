#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <ReactNativeSqliteKitSpec/ReactNativeSqliteKitSpec.h>

NS_ASSUME_NONNULL_BEGIN

@interface RNSqliteKit : NSObject <NativeReactNativeSqliteKitSpec> {
 @private
  NSMutableDictionary<NSString *, NSValue *> *_databases;
  NSMutableDictionary<NSString *, NSString *> *_connections;
  NSMutableDictionary<NSString *, NSNumber *> *_referenceCounts;
  dispatch_queue_t _queue;
}
@end

NS_ASSUME_NONNULL_END
