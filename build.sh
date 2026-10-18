#!/bin/bash
set -e
: "${KS_PASS:?Set KS_PASS to the keystore password (kept privately, not in the repo)}"
export KS_PASS
A=/workspace/work/apk; R=/workspace/work/scorched-android; O=$A/out
AJ=$A/p/android-34/android.jar; BT=$(ls -d $A/b/*)
rm -rf $O; mkdir -p $O/gen $O/classes $O/dex $O/assets
cp /workspace/built/sites/bee5e85c-6b52-4a9a-ad9a-b052f91b2ca7/*.{html,css,js} $O/assets/
sed 's#<manifest xmlns:android="http://schemas.android.com/apk/res/android">#<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.yishai.scorchedtanks" android:versionCode="'${VC:-1}'" android:versionName="1.'${VC:-1}'">#' $R/app/src/main/AndroidManifest.xml > $O/AndroidManifest.xml
aapt package -f -m -J $O/gen -M $O/AndroidManifest.xml -S $R/app/src/main/res -I $AJ --min-sdk-version 24 --target-sdk-version 28
javac -nowarn --release 11 -cp $AJ -d $O/classes $O/gen/com/yishai/scorchedtanks/R.java $R/app/src/main/java/com/yishai/scorchedtanks/MainActivity.java 2>&1 | grep -v "^Note" || true
java -cp $BT/lib/d8.jar com.android.tools.r8.D8 --release --min-api 24 --lib $AJ --output $O/dex $(find $O/classes -name '*.class')
aapt package -f -M $O/AndroidManifest.xml -S $R/app/src/main/res -A $O/assets -I $AJ --min-sdk-version 24 --target-sdk-version 28 -F $O/unsigned.apk
cd $O/dex && aapt add $O/unsigned.apk classes.dex >/dev/null && cd $O
zipalign -f 4 unsigned.apk aligned.apk
[ -f $A/key.jks ] || keytool -genkeypair -keystore $A/key.jks -storepass:env KS_PASS -keypass:env KS_PASS -alias st -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Scorched Tanks" >/dev/null 2>&1
java -jar $BT/lib/apksigner.jar sign --ks $A/key.jks --ks-pass env:KS_PASS --key-pass env:KS_PASS --ks-key-alias st --out $O/ScorchedTanks.apk aligned.apk
java -jar $BT/lib/apksigner.jar verify --print-certs $O/ScorchedTanks.apk | head -2
ls -la $O/ScorchedTanks.apk
