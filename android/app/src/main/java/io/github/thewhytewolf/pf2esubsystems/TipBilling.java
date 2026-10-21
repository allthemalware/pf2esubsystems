package io.github.thewhytewolf.pf2esubsystems;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ConsumeParams;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Optional consumable tips. Google Play owns checkout; no payment data enters the WebView. */
final class TipBilling {
    private final Activity activity;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final BillingClient client;
    private final TipPurchases purchases;
    private boolean closed;
    private boolean resumed;
    private boolean connecting;
    private boolean queryingPurchases;
    private boolean queryingProducts;
    private int productRequest;
    private boolean requested;
    private boolean checkout;
    private int deferredNotice;
    private AlertDialog chooser;

    TipBilling(Activity activity) {
        this.activity = activity;
        purchases = new TipPurchases(activity.getPackageName());
        client = BillingClient.newBuilder(activity.getApplicationContext())
                .setListener((result, updates) -> main.post(() -> {
                    if (closed) return;
                    checkout = false;
                    if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && updates != null) {
                        process(updates, true);
                    } else if (result.getResponseCode() == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
                        recoverPurchases();
                    } else {
                        notice(errorMessage(result));
                    }
                }))
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .enableAutoServiceReconnection()
                .build();
    }

    void onResume() {
        resumed = true;
        if (deferredNotice != 0) {
            int message = deferredNotice;
            deferredNotice = 0;
            notice(message);
        }
        // Includes unfinished tips from an earlier app launch and completed pending payments.
        connect();
    }

    void onPause() {
        resumed = false;
        requested = false;
        productRequest++;
        queryingProducts = false;
        if (chooser != null) chooser.dismiss();
    }

    void showTips() {
        if (closed || !resumed || checkout || chooser != null || requested || queryingProducts) return;
        requested = true;
        notice(R.string.tip_loading);
        connect();
    }

    private void connect() {
        if (closed) return;
        if (client.isReady()) {
            recoverPurchases();
        } else if (!connecting) {
            connecting = true;
            client.startConnection(new BillingClientStateListener() {
                @Override
                public void onBillingSetupFinished(BillingResult result) {
                    main.post(() -> {
                        if (closed) return;
                        connecting = false;
                        if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) recoverPurchases();
                        else if (requested) { requested = false; notice(errorMessage(result)); }
                    });
                }

                @Override
                public void onBillingServiceDisconnected() {
                    // The library reconnects on subsequent operations; the next tap/resume also retries.
                    main.post(() -> { connecting = false; });
                }
            });
        }
    }

    private void recoverPurchases() {
        if (closed || queryingPurchases) return;
        queryingPurchases = true;
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.INAPP).build(), (result, owned) -> main.post(() -> {
                    if (closed) return;
                    queryingPurchases = false;
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                        if (requested) { requested = false; notice(errorMessage(result)); }
                        return;
                    }
                    boolean pending = process(owned, requested);
                    if (requested) {
                        requested = false;
                        if (pending) return; // process() already explained the pending payment.
                        if (purchases.isConsuming()) notice(R.string.tip_processing);
                        else if (resumed) queryProducts();
                    }
                }));
    }

    private void queryProducts() {
        queryingProducts = true;
        int request = ++productRequest;
        List<QueryProductDetailsParams.Product> products = new ArrayList<>();
        for (String id : TipPurchases.PRODUCTS) {
            products.add(QueryProductDetailsParams.Product.newBuilder().setProductId(id)
                    .setProductType(BillingClient.ProductType.INAPP).build());
        }
        client.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(products).build(),
                (result, details) -> main.post(() -> {
                    if (closed || request != productRequest) return;
                    queryingProducts = false;
                    if (!resumed) return;
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                        notice(errorMessage(result));
                        return;
                    }
                    List<TipOption> options = new ArrayList<>();
                    // Stable small/medium/large order; unavailable products are never offered.
                    for (String id : TipPurchases.PRODUCTS) {
                        for (ProductDetails product : details.getProductDetailsList()) {
                            if (!id.equals(product.getProductId())) continue;
                            List<ProductDetails.OneTimePurchaseOfferDetails> offers = product.getOneTimePurchaseOfferDetailsList();
                            if (offers == null) continue;
                            for (ProductDetails.OneTimePurchaseOfferDetails offer : offers) {
                                // Only the ordinary buy option configured for tipping, never rentals or preorders.
                                if (!"tip".equals(offer.getPurchaseOptionId()) || offer.getRentalDetails() != null
                                        || offer.getPreorderDetails() != null
                                        || (offer.getOfferId() != null && !offer.getOfferId().isEmpty())
                                        || offer.getPriceAmountMicros() <= 0 || offer.getOfferToken().isEmpty()) continue;
                                options.add(new TipOption(product, offer));
                                break;
                            }
                        }
                    }
                    if (options.isEmpty()) { notice(R.string.tip_not_configured); return; }
                    showChooser(options);
                }));
    }

    private void showChooser(List<TipOption> options) {
        String[] labels = new String[options.size()];
        for (int i = 0; i < labels.length; i++) {
            TipOption option = options.get(i);
            int name = option.product.getProductId().equals("tip_small") ? R.string.tip_small
                    : option.product.getProductId().equals("tip_medium") ? R.string.tip_medium : R.string.tip_large;
            labels[i] = activity.getString(name) + " · " + option.offer.getFormattedPrice();
        }
        // The explanation is a header so AlertDialog does not hide its list behind a message.
        android.widget.ListView list = new android.widget.ListView(activity);
        android.widget.TextView explanation = new android.widget.TextView(activity);
        int padding = Math.round(24 * activity.getResources().getDisplayMetrics().density);
        explanation.setPadding(padding, padding / 2, padding, padding / 2);
        explanation.setText(R.string.tip_explanation);
        list.addHeaderView(explanation, null, false);
        list.setAdapter(new android.widget.ArrayAdapter<>(activity, android.R.layout.simple_list_item_1, labels));
        list.setOnItemClickListener((parent, view, position, id) -> {
            TipOption option = options.get(position - list.getHeaderViewsCount());
            chooser.dismiss();
            launch(option);
        });
        chooser = new AlertDialog.Builder(activity).setTitle(R.string.tip_title).setView(list)
                .setNegativeButton(android.R.string.cancel, null).create();
        chooser.setOnDismissListener(dialog -> chooser = null);
        chooser.show();
    }

    private void launch(TipOption option) {
        if (closed || !resumed || checkout) return;
        checkout = true;
        BillingFlowParams.ProductDetailsParams product = BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(option.product).setOfferToken(option.offer.getOfferToken()).build();
        BillingResult result = client.launchBillingFlow(activity, BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(Collections.singletonList(product)).build());
        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
            checkout = false;
            if (result.getResponseCode() == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) recoverPurchases();
            else notice(errorMessage(result));
        }
    }

    private boolean process(List<Purchase> updates, boolean explainPending) {
        boolean pending = false;
        for (Purchase purchase : updates) {
            TipPurchases.Payment state = purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED
                    ? TipPurchases.Payment.PURCHASED : purchase.getPurchaseState() == Purchase.PurchaseState.PENDING
                    ? TipPurchases.Payment.PENDING : TipPurchases.Payment.OTHER;
            String token = purchase.getPurchaseToken();
            TipPurchases.Action action = purchases.receive(purchase.getPackageName(), purchase.getProducts(), token, state);
            if (action == TipPurchases.Action.WAIT) pending = true;
            if (action != TipPurchases.Action.CONSUME) continue;
            // Play validates the token while consuming. There is no paid entitlement or local purchase flag.
            // Consumption acknowledges the tip and permits buying the same tip again.
            client.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(token).build(), (result, ignored) -> main.post(() -> {
                if (closed) return;
                boolean success = result.getResponseCode() == BillingClient.BillingResponseCode.OK;
                if (purchases.finish(token, success)) notice(R.string.tip_thanks);
                else if (!success) notice(R.string.tip_finish_later);
            }));
        }
        if (pending && explainPending) notice(R.string.tip_pending);
        return pending;
    }

    private int errorMessage(BillingResult result) {
        switch (result.getResponseCode()) {
            case BillingClient.BillingResponseCode.USER_CANCELED: return R.string.tip_cancelled;
            case BillingClient.BillingResponseCode.BILLING_UNAVAILABLE:
            case BillingClient.BillingResponseCode.FEATURE_NOT_SUPPORTED: return R.string.tip_unavailable;
            case BillingClient.BillingResponseCode.ITEM_UNAVAILABLE: return R.string.tip_not_configured;
            case BillingClient.BillingResponseCode.NETWORK_ERROR:
            case BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE:
            case BillingClient.BillingResponseCode.SERVICE_DISCONNECTED: return R.string.tip_connection_error;
            default: return R.string.tip_error;
        }
    }

    private void notice(int message) {
        if (closed || activity.isDestroyed() || activity.isFinishing()) return;
        if (!resumed) { deferredNotice = message; return; }
        Toast.makeText(activity, message, Toast.LENGTH_LONG).show();
    }

    void close() {
        closed = true;
        if (chooser != null) chooser.dismiss();
        client.endConnection();
        main.removeCallbacksAndMessages(null);
    }

    private static final class TipOption {
        final ProductDetails product;
        final ProductDetails.OneTimePurchaseOfferDetails offer;
        TipOption(ProductDetails product, ProductDetails.OneTimePurchaseOfferDetails offer) {
            this.product = product;
            this.offer = offer;
        }
    }
}
