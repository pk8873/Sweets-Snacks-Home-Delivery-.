from asgiref.sync import sync_to_async

from .models import DeliveryZone


@sync_to_async
def get_delivery_charge(distance_km):
    zone = (
        DeliveryZone.objects
        .filter(
            active=True,
            minimum_distance__lte=distance_km,
            maximum_distance__gte=distance_km,
        )
        .order_by("minimum_distance")
        .first()
    )

    if not zone:
        return None

    return {
        "zone": zone,
        "charge": zone.charge,
    }