import json
import os
from decimal import Decimal
from pathlib import Path
from django.http import FileResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from cart.models import Cart, CartItem
from customers.models import Customer, CustomerAddress
from orders.models import Order
from orders.services import create_order, reorder_order
from payments.services import create_razorpay_order
from products.models import Category, Favorite, Product
from .models import WhatsAppContact

BOT_SECRET=os.getenv("WHATSAPP_BOT_SECRET","").strip()
def _authorized(request): return bool(BOT_SECRET) and request.headers.get("X-WhatsApp-Bot-Secret","")==BOT_SECRET
def _json(request):
    try:return json.loads(request.body or "{}")
    except json.JSONDecodeError:return {}
def _error(message,status=400):return JsonResponse({"ok":False,"error":message},status=status)
def _contact(data):
    wa_id=str(data.get("wa_id") or "").strip()
    if not wa_id:raise ValueError("wa_id is required.")
    name=str(data.get("display_name") or "Customer").strip()[:150]; phone=str(data.get("phone") or wa_id).strip()[:15]
    contact=WhatsAppContact.objects.select_related("customer").filter(wa_id=wa_id).first()
    if contact:
        c=contact.customer; cu=[]; co=[]
        if name and c.name!=name:c.name=name;cu.append("name")
        if phone and c.phone!=phone:c.phone=phone;cu.append("phone")
        if cu:cu.append("updated_at");c.save(update_fields=cu)
        if contact.display_name!=name:contact.display_name=name;co.append("display_name")
        if contact.phone!=phone:contact.phone=phone;co.append("phone")
        if co:co.append("updated_at");contact.save(update_fields=co)
        return contact
    c=Customer.objects.create(telegram_user_id=None,name=name,phone=phone,language="hi")
    return WhatsAppContact.objects.create(customer=c,wa_id=wa_id,display_name=name,phone=phone)
def _product_data(request,p):
    image_url=request.build_absolute_uri(f"/whatsapp/api/products/{p.id}/image/") if p.image else None
    base=max(int(p.weight_grams or 1000),250); weights=[g for g in (250,500,750,1000) if g<=base]
    return {"id":p.id,"name":p.name,"description":p.description,"price":str(p.price),"selling_unit":p.selling_unit,"is_weight_based":p.is_weight_based,"weight_grams":p.weight_grams,"stock":p.stock,"stock_grams":p.stock_grams,"available":p.available,"price_quantity_label":p.price_quantity_label,"stock_display":p.stock_display,"image_url":image_url,"category":p.category.name,"category_emoji":p.category.emoji or "🍽️","weight_options":weights}

@csrf_exempt
def api(request,action="menu"):
    if not _authorized(request):return _error("Unauthorized.",401)
    data=_json(request) if request.method!="GET" else request.GET.dict()
    try:
        if action=="menu":
            cs=Category.objects.filter(active=True).order_by("name");return JsonResponse({"ok":True,"categories":[{"id":c.id,"name":c.name,"emoji":c.emoji or "🍽️"} for c in cs]})
        if action=="products":
            ps=Product.objects.filter(category_id=int(data["category_id"]),available=True).select_related("category").order_by("name");return JsonResponse({"ok":True,"products":[_product_data(request,p) for p in ps]})
        if action=="product":
            p=Product.objects.filter(id=int(data["product_id"]),available=True).select_related("category").first()
            if not p:raise ValueError("Product not found or unavailable.")
            return JsonResponse({"ok":True,"product":_product_data(request,p)})
        if action=="search":
            q=str(data.get("q") or "").strip()
            if not q:raise ValueError("Search text is required.")
            ps=Product.objects.filter(available=True,name__icontains=q).select_related("category").order_by("name")[:20]
            if not ps:ps=Product.objects.filter(available=True,description__icontains=q).select_related("category").order_by("name")[:20]
            return JsonResponse({"ok":True,"products":[_product_data(request,p) for p in ps]})
        if action=="customer":
            x=_contact(data);a=x.customer.addresses.filter(is_default=True).first();return JsonResponse({"ok":True,"customer":{"id":x.customer_id,"name":x.customer.name,"phone":x.customer.phone or x.phone,"language":x.customer.language},"contact":{"wa_id":x.wa_id},"address":None if not a else {"id":a.id,"address":a.address,"city":a.city,"pincode":a.pincode}})
        if action=="favorites":
            x=_contact(data);ps=Product.objects.filter(favorites__customer=x.customer,available=True).select_related("category").order_by("name");return JsonResponse({"ok":True,"products":[_product_data(request,p) for p in ps]})
        if action=="favorite/toggle":
            x=_contact(data);p=Product.objects.filter(id=int(data["product_id"])).first()
            if not p:raise ValueError("Product not found.")
            f=Favorite.objects.filter(customer=x.customer,product=p).first()
            if f:f.delete();msg="💔 Removed from favorites.";fav=False
            else:Favorite.objects.create(customer=x.customer,product=p);msg="❤️ Added to favorites.";fav=True
            return JsonResponse({"ok":True,"message":msg,"favorite":fav})
        if action=="cart":
            x=_contact(data);cart,_=Cart.objects.get_or_create(customer=x.customer);items=cart.items.select_related("product").all();return JsonResponse({"ok":True,"items":[{"id":i.id,"product_id":i.product_id,"name":i.product.name,"quantity":i.quantity,"quantity_grams":i.quantity_grams,"price":str(i.price),"subtotal":str(i.subtotal),"is_weight_based":i.product.is_weight_based} for i in items],"subtotal":str(cart.subtotal),"total_items":cart.total_items})
        if action=="cart/add":
            x=_contact(data);p=Product.objects.get(id=int(data["product_id"]),available=True);q=max(int(data.get("quantity",1)),1);g=int(data.get("quantity_grams",0) or 0)
            if p.is_weight_based:
                if g not in {250,500,750,1000,int(p.weight_grams or 0)}:raise ValueError("Invalid weight selection.")
                if g*q>p.stock_grams:raise ValueError(f"Only {p.stock_grams}g available.")
            else:
                g=0
                if q>p.stock:raise ValueError(f"Only {p.stock} available.")
            cart,_=Cart.objects.get_or_create(customer=x.customer);item,_=CartItem.objects.get_or_create(cart=cart,product=p,quantity_grams=g,defaults={"quantity":0,"price":p.price});n=item.quantity+q
            if p.is_weight_based and n*g>p.stock_grams:raise ValueError(f"Only {p.stock_grams}g available.")
            if not p.is_weight_based and n>p.stock:raise ValueError(f"Only {p.stock} available.")
            item.quantity=n;item.price=p.price;item.save();return JsonResponse({"ok":True,"message":"Added to cart.","cart_item_id":item.id})
        if action=="cart/remove":
            x=_contact(data);deleted,_=CartItem.objects.filter(id=int(data["cart_item_id"]),cart__customer=x.customer).delete();return JsonResponse({"ok":True,"deleted":bool(deleted)})
        if action=="address":
            x=_contact(data);a=str(data.get("address") or "").strip();city=str(data.get("city") or "").strip()[:100];pin=str(data.get("pincode") or "").strip()[:10]
            if not a or not city or not pin:raise ValueError("Address, city and pincode are required.")
            CustomerAddress.objects.filter(customer=x.customer,is_default=True).update(is_default=False);obj=CustomerAddress.objects.create(customer=x.customer,label="home",address=a,city=city,pincode=pin,is_default=True);return JsonResponse({"ok":True,"address_id":obj.id})
        if action=="checkout":
            x=_contact(data);aid=int(data.get("address_id") or 0)
            if not aid:
                a=x.customer.addresses.filter(is_default=True).first()
                if not a:raise ValueError("Please save a delivery address first.")
                aid=a.id
            method=str(data.get("payment_method") or "cod").lower()
            if method not in {"cod","online"}:raise ValueError("Invalid payment method.")
            o=create_order(customer_id=x.customer_id,address_id=aid,payment_method=method,delivery_charge=Decimal("0.00"),discount=Decimal("0.00"));result={"ok":True,"order_id":o.order_id,"total":str(o.total_amount),"payment_method":method,"payment_status":o.payment_status}
            if method=="online":
                try:
                    pay,gateway=create_razorpay_order(o);result["payment_url"]=request.build_absolute_uri(f"/payments/telegram/{o.order_id}/");result["gateway_order_id"]=gateway["id"];result["payment_id"]=pay.id
                except Exception as exc:o.payment_status="failed";o.save(update_fields=["payment_status","updated_at"]);result["payment_url"]=None;result["payment_error"]=str(exc)
            return JsonResponse(result)
        if action=="orders":
            x=_contact(data);os=Order.objects.filter(customer=x.customer).order_by("-created_at")[:10];return JsonResponse({"ok":True,"orders":[{"order_id":o.order_id,"created_at":o.created_at.isoformat(),"total":str(o.total_amount),"status":o.order_status,"payment_status":o.payment_status,"payment_method":o.payment_method} for o in os]})
        if action=="order":
            x=_contact(data);o=Order.objects.filter(customer=x.customer,order_id=str(data.get("order_id") or "")).prefetch_related("items").first()
            if not o:raise ValueError("Order not found.")
            return JsonResponse({"ok":True,"order":{"order_id":o.order_id,"created_at":o.created_at.isoformat(),"total":str(o.total_amount),"subtotal":str(o.subtotal),"delivery_charge":str(o.delivery_charge),"status":o.order_status,"payment_status":o.payment_status,"payment_method":o.payment_method,"address":o.address,"items":[{"name":i.product_name,"quantity":i.quantity,"quantity_grams":i.quantity_grams,"subtotal":str(i.subtotal)} for i in o.items.all()]}})
        if action=="reorder":
            x=_contact(data);r=reorder_order(x.customer_id,str(data.get("order_id") or ""));added=r.get("added",[]);skipped=r.get("skipped",[]);msg="🔄 Reorder added to cart." if added else "⚠️ No items could be reordered."
            if skipped:msg+="\n\n⚠️ Skipped:\n"+"\n".join(f"• {v}" for v in skipped)
            return JsonResponse({"ok":True,"message":msg,"added":added,"skipped":skipped})
        return _error("Unknown action.",404)
    except (ValueError,KeyError,Category.DoesNotExist,Product.DoesNotExist):return _error("Invalid request or unavailable item.")
    except Exception as exc:return _error(str(exc),500)

# Product images are intentionally public because Baileys/WhatsApp fetches the image URL
# itself and cannot attach the private X-WhatsApp-Bot-Secret header. Shopping data APIs
# remain protected by the shared secret above.
def product_image(request,product_id):
    p=Product.objects.filter(id=product_id).first()
    if not p or not p.image:return _error("Image not found.",404)
    try:
        path=Path(p.image.path)
        if not path.exists():return _error("Image file is missing.",404)
        content_type="image/jpeg"
        name=path.name.lower()
        if name.endswith(".png"):content_type="image/png"
        elif name.endswith(".webp"):content_type="image/webp"
        elif name.endswith(".gif"):content_type="image/gif"
        return FileResponse(open(path,"rb"),content_type=content_type)
    except Exception:return _error("Image could not be opened.",404)
