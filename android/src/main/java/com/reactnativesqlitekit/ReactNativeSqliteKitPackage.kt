package com.reactnativesqlitekit

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class ReactNativeSqliteKitPackage : BaseReactPackage() {
  override fun getModule(
    name: String,
    reactContext: ReactApplicationContext,
  ): NativeModule? =
    if (name == ReactNativeSqliteKitModule.NAME) {
      ReactNativeSqliteKitModule(reactContext)
    } else {
      null
    }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider {
      mapOf(
        ReactNativeSqliteKitModule.NAME to ReactModuleInfo(
          ReactNativeSqliteKitModule.NAME,
          ReactNativeSqliteKitModule::class.java.name,
          false,
          false,
          false,
          true,
        ),
      )
    }
}
